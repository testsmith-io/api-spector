// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { type IpcMain, shell } from 'electron';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { IPC } from '../../shared/ipc-channels';
import { handleIpc } from './handle';

// Interactive Vault OIDC login. Opens the system browser to Vault's OIDC auth
// URL, captures the callback on a localhost loopback, and exchanges it for a
// short-lived Vault token. The token is placed in process.env.VAULT_TOKEN for
// this session so the Vault secret provider uses it — it is never written to the
// workspace or exposed to the renderer.
//
// Modelled on the loopback pattern in oauth2-handler.ts. The redirect URI is
// Vault's CLI default (http://localhost:8250/oidc/callback), which OIDC roles
// typically already allow in allowed_redirect_uris.

export interface VaultOidcOptions {
  address: string;
  mount?: string;
  role?: string;
  namespace?: string;
  skipVerify?: boolean;
}

const CALLBACK_PORT = 8250;
const CALLBACK_PATH = '/oidc/callback';

export function registerVaultHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.vault.oidcLogin, async (
    _e,
    opts: VaultOidcOptions,
  ): Promise<{ ok: true; expiresInSeconds: number; entityId?: string }> => {
    const address = (opts.address ?? '').replace(/\/+$/, '');
    if (!address) throw new Error('Vault OIDC: address is required.');
    const mount = opts.mount?.trim() || 'oidc';
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
    const clientNonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    const { fetch: nodeFetch, Agent } = await import('undici');
    const dispatcher = opts.skipVerify ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
    const nsHeaders: Record<string, string> = opts.namespace ? { 'X-Vault-Namespace': opts.namespace } : {};

    const vault = async (path: string, init: Record<string, unknown> = {}) => {
      const res = await nodeFetch(`${address}/v1/${path}`, {
        ...init,
        headers: { ...nsHeaders, ...(init.headers as Record<string, string> | undefined) },
        ...(dispatcher ? { dispatcher } : {}),
      } as never);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Vault ${res.status} on /v1/${path}: ${body.slice(0, 300)}`);
      }
      return res.json() as Promise<any>;
    };

    // 1. Ask Vault for the provider auth URL.
    const authUrlResp = await vault(`auth/${mount}/oidc/auth_url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uri: redirectUri, role: opts.role || undefined, client_nonce: clientNonce }),
    });
    const authUrl: string | undefined = authUrlResp?.data?.auth_url;
    if (!authUrl) throw new Error('Vault OIDC: no auth_url returned (check the mount, role, and allowed redirect URIs).');

    // 2. Open the browser and capture the callback on the loopback.
    const params = await new Promise<URLSearchParams>((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const reqUrl = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
        if (!reqUrl.pathname.startsWith(CALLBACK_PATH)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><p>Vault sign-in complete. You may close this tab.</p></body></html>');
        server.close();
        const error = reqUrl.searchParams.get('error');
        if (error) { reject(new Error(`Vault OIDC error: ${error}`)); return; }
        resolve(reqUrl.searchParams);
      });
      server.on('error', reject);
      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        shell.openExternal(authUrl).catch(reject);
      });
      setTimeout(() => { server.close(); reject(new Error('Vault OIDC sign-in timed out (5 min).')); }, 5 * 60 * 1000);
    });

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) throw new Error('Vault OIDC: callback missing code/state.');

    // 3. Exchange for a Vault token.
    const cb = new URLSearchParams({ state, code, client_nonce: clientNonce });
    const login = await vault(`auth/${mount}/oidc/callback?${cb.toString()}`);
    const token: string | undefined = login?.auth?.client_token;
    if (!token) throw new Error('Vault OIDC: callback did not return a client token.');

    // Use it for this session; the provider reads VAULT_TOKEN.
    process.env.VAULT_TOKEN = token;

    return {
      ok: true,
      expiresInSeconds: Number(login?.auth?.lease_duration ?? 0),
      entityId: login?.auth?.entity_id ? String(login.auth.entity_id) : undefined,
    };
  });
}
