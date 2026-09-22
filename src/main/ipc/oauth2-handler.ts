// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, shell } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AuthConfig, Oauth2Auth } from '../../shared/types';
import { getSecret } from './secret-handler';
import { interpolate } from '../interpolation';
import { fetchOAuth2Token } from '../auth-builder';

interface OAuth2TokenResult { accessToken: string; expiresAt: number; refreshToken?: string }

// Resolve the client secret from either the inline value or the keychain ref,
// then interpolate {{vars}}.
async function resolveClientSecret(auth: Oauth2Auth, vars: Record<string, string>): Promise<string> {
  let secret = auth.oauth2ClientSecret ?? '';
  if (!secret && auth.oauth2ClientSecretRef) {
    secret = (await getSecret(auth.oauth2ClientSecretRef)) ?? '';
  }
  return interpolate(secret, vars);
}

// ─── Browser-redirect flows (authorization_code, implicit) ─────────────────────
// Opens the system browser and runs a one-shot localhost server to catch the
// redirect. authorization_code returns a `code` (exchanged for a token below);
// implicit returns the token directly in the URL fragment (relayed to the
// server by a tiny page, since fragments never reach the server otherwise).
async function browserFlow(
  auth: Oauth2Auth,
  vars: Record<string, string>,
  flow: 'authorization_code' | 'implicit',
): Promise<OAuth2TokenResult> {
  const port        = auth.oauth2RedirectPort ?? 9876;
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl     = interpolate(auth.oauth2AuthUrl ?? '', vars);
  const clientId    = interpolate(auth.oauth2ClientId ?? '', vars);

  if (!authUrl)  throw new Error(`OAuth 2.0: authUrl is required for the ${flow} flow.`);
  if (!clientId) throw new Error('OAuth 2.0: clientId is required.');

  const state       = Math.random().toString(36).slice(2);
  const authUrlFull = new URL(authUrl);
  authUrlFull.searchParams.set('response_type', flow === 'implicit' ? 'token' : 'code');
  authUrlFull.searchParams.set('client_id', clientId);
  authUrlFull.searchParams.set('redirect_uri', redirectUri);
  authUrlFull.searchParams.set('state', state);
  if (auth.oauth2Scopes) authUrlFull.searchParams.set('scope', auth.oauth2Scopes);

  const captured = await new Promise<Record<string, string>>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);

      // Implicit: the token is in the URL fragment, which the server can't see.
      // Serve a page that copies the fragment into a query and reloads.
      if (flow === 'implicit'
          && reqUrl.pathname === '/callback'
          && !reqUrl.searchParams.get('access_token')
          && !reqUrl.searchParams.get('error')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body><p>Completing sign-in… you may close this tab.</p>'
          + '<script>location.replace("/callback/capture?" + (location.hash ? location.hash.substring(1) : ""));</script>'
          + '</body></html>');
        return;
      }

      if (reqUrl.pathname !== '/callback' && reqUrl.pathname !== '/callback/capture') {
        res.writeHead(404);
        res.end();
        return;
      }

      const params = Object.fromEntries(reqUrl.searchParams.entries());
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body><p>Authorization complete. You may close this tab.</p></body></html>');
      server.close();

      if (params['error']) { reject(new Error(`OAuth 2.0 authorization error: ${params['error_description'] ?? params['error']}`)); return; }
      if (params['state'] !== state) { reject(new Error('OAuth 2.0: state mismatch.')); return; }
      resolve(params);
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      shell.openExternal(authUrlFull.toString()).catch(reject);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth 2.0 authorization timed out (5 min).'));
    }, 5 * 60 * 1000);
  });

  // Implicit: the access token comes straight back — no exchange.
  if (flow === 'implicit') {
    const accessToken = captured['access_token'] ?? '';
    if (!accessToken) throw new Error('OAuth 2.0: no access_token in implicit callback.');
    const expiresIn = Number(captured['expires_in'] ?? 3600);
    return { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  }

  // Authorization code: exchange the code for a token.
  const code = captured['code'] ?? '';
  if (!code) throw new Error('OAuth 2.0: no code in callback.');

  const tokenUrl = interpolate(auth.oauth2TokenUrl ?? '', vars);
  if (!tokenUrl) throw new Error('OAuth 2.0: tokenUrl is required for the authorization_code flow.');
  const clientSecret = await resolveClientSecret(auth, vars);

  const { fetch: nodeFetch } = await import('undici');
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', redirectUri);
  params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  const resp = await nodeFetch(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth 2.0 token exchange failed (${resp.status}): ${body}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  const accessToken = String(json['access_token'] ?? '');
  if (!accessToken) throw new Error('OAuth 2.0: token response missing access_token.');

  const expiresIn = Number(json['expires_in'] ?? 3600);
  return {
    accessToken,
    expiresAt:    Date.now() + expiresIn * 1000,
    refreshToken: json['refresh_token'] ? String(json['refresh_token']) : undefined,
  };
}

// ─── OAuth 2.0 IPC handlers ───────────────────────────────────────────────────

export function registerOAuth2Handlers(ipc: IpcMain): void {
  // ── oauth2:startFlow — dispatches on the selected grant type ────────────────
  // authorization_code / implicit run through the browser; client_credentials /
  // password are a direct server-to-server token request (no browser).
  handleIpc(ipc, IPC.oauth2.startFlow, async (
    _e,
    auth: AuthConfig,
    vars: Record<string, string>,
  ): Promise<OAuth2TokenResult> => {
    if (auth.type !== 'oauth2') throw new Error('OAuth 2.0: auth is not an oauth2 config.');

    const flow = auth.oauth2Flow ?? 'client_credentials';
    if (flow === 'authorization_code' || flow === 'implicit') {
      return browserFlow(auth, vars, flow);
    }
    // client_credentials or password — no browser round-trip needed.
    return fetchOAuth2Token(auth, vars);
  });

  // ── oauth2:refreshToken ────────────────────────────────────────────────────
  handleIpc(ipc, IPC.oauth2.refreshToken, async (
    _e,
    auth: AuthConfig,
    vars: Record<string, string>,
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> => {
    const tokenUrl   = interpolate(auth.oauth2TokenUrl ?? '', vars);
    const clientId   = interpolate(auth.oauth2ClientId ?? '', vars);
    let clientSecret = auth.oauth2ClientSecret ?? '';
    if (!clientSecret && auth.oauth2ClientSecretRef) {
      clientSecret = (await getSecret(auth.oauth2ClientSecretRef)) ?? '';
    }
    clientSecret = interpolate(clientSecret, vars);

    if (!tokenUrl) throw new Error('OAuth 2.0: tokenUrl is required for refresh.');

    const { fetch: nodeFetch } = await import('undici');
    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refreshToken);
    params.set('client_id', clientId);
    if (clientSecret) params.set('client_secret', clientSecret);

    const resp = await nodeFetch(tokenUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OAuth 2.0 token refresh failed (${resp.status}): ${body}`);
    }

    const json = await resp.json() as Record<string, unknown>;
    const accessToken = String(json['access_token'] ?? '');
    if (!accessToken) throw new Error('OAuth 2.0: refresh response missing access_token.');

    const expiresIn = Number(json['expires_in'] ?? 3600);
    return {
      accessToken,
      expiresAt:    Date.now() + expiresIn * 1000,
      refreshToken: json['refresh_token'] ? String(json['refresh_token']) : refreshToken,
    };
  });
}
