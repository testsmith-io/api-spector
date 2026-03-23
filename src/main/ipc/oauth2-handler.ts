import { type IpcMain, shell } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AuthConfig } from '../../shared/types';
import { getSecret } from './secret-handler';
import { interpolate } from '../interpolation';

// ─── OAuth 2.0 IPC handlers ───────────────────────────────────────────────────

export function registerOAuth2Handlers(ipc: IpcMain): void {
  // ── oauth2:startFlow — authorization_code ──────────────────────────────────
  ipc.handle('oauth2:startFlow', async (
    _e,
    auth: AuthConfig,
    vars: Record<string, string>,
  ): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> => {
    const port        = auth.oauth2RedirectPort ?? 9876;
    const redirectUri = `http://localhost:${port}/callback`;
    const authUrl     = interpolate(auth.oauth2AuthUrl ?? '', vars);
    const tokenUrl    = interpolate(auth.oauth2TokenUrl ?? '', vars);
    const clientId    = interpolate(auth.oauth2ClientId ?? '', vars);
    let clientSecret  = auth.oauth2ClientSecret ?? '';
    if (!clientSecret && auth.oauth2ClientSecretRef) {
      clientSecret = (await getSecret(auth.oauth2ClientSecretRef)) ?? '';
    }
    clientSecret = interpolate(clientSecret, vars);

    if (!authUrl)   throw new Error('OAuth 2.0: authUrl is required for authorization_code flow.');
    if (!tokenUrl)  throw new Error('OAuth 2.0: tokenUrl is required for authorization_code flow.');
    if (!clientId)  throw new Error('OAuth 2.0: clientId is required.');

    // Build the authorization URL
    const state        = Math.random().toString(36).slice(2);
    const authUrlFull  = new URL(authUrl);
    authUrlFull.searchParams.set('response_type', 'code');
    authUrlFull.searchParams.set('client_id', clientId);
    authUrlFull.searchParams.set('redirect_uri', redirectUri);
    authUrlFull.searchParams.set('state', state);
    if (auth.oauth2Scopes) authUrlFull.searchParams.set('scope', auth.oauth2Scopes);

    // Start local server to capture the redirect
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
        if (!reqUrl.pathname.startsWith('/callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const returnedState = reqUrl.searchParams.get('state');
        const returnedCode  = reqUrl.searchParams.get('code');
        const error         = reqUrl.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><p>Authorization complete. You may close this tab.</p></body></html>');
        server.close();

        if (error) { reject(new Error(`OAuth 2.0 authorization error: ${error}`)); return; }
        if (returnedState !== state) { reject(new Error('OAuth 2.0: state mismatch.')); return; }
        if (!returnedCode) { reject(new Error('OAuth 2.0: no code in callback.')); return; }

        resolve(returnedCode);
      });

      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        // Open browser after server is listening
        shell.openExternal(authUrlFull.toString()).catch(reject);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth 2.0 authorization timed out (5 min).'));
      }, 5 * 60 * 1000);
    });

    // Exchange code for token
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
  });

  // ── oauth2:refreshToken ────────────────────────────────────────────────────
  ipc.handle('oauth2:refreshToken', async (
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
