// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { Socket } from 'net';
import crypto from 'crypto';

vi.mock('../main/ipc/secret-handler', () => ({ getSecret: vi.fn().mockResolvedValue(null) }));

import { performNtlmRequest } from '../main/auth-builder';
import { ntowfv2 } from '../main/ntlm';

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');
const USER = 'alice';
const DOMAIN = 'CORP';
const PASSWORD = 'S3cret!';

// Minimal Type 2 (challenge) builder for the fake server.
function buildType2(serverChallenge: Buffer, targetInfo: Buffer): string {
  const buf = Buffer.alloc(48 + targetInfo.length);
  SIGNATURE.copy(buf, 0);
  buf.writeUInt32LE(2, 8);                       // MessageType
  buf.writeUInt32LE(0x00088205, 20);             // flags (unicode + ntlm + target info)
  serverChallenge.copy(buf, 24);
  buf.writeUInt16LE(targetInfo.length, 40);
  buf.writeUInt16LE(targetInfo.length, 42);
  buf.writeUInt32LE(48, 44);
  targetInfo.copy(buf, 48);
  return buf.toString('base64');
}

const hmacMd5 = (key: Buffer, data: Buffer) => crypto.createHmac('md5', key).update(data).digest();

// Server-side NTLMv2 verification: recompute NTProofStr from the client's blob.
function verifyType3(type3: Buffer, serverChallenge: Buffer): boolean {
  if (!type3.subarray(0, 8).equals(SIGNATURE) || type3.readUInt32LE(8) !== 3) return false;
  const ntLen = type3.readUInt16LE(20);
  const ntOff = type3.readUInt32LE(24);
  const ntResponse = type3.subarray(ntOff, ntOff + ntLen);
  const proof = ntResponse.subarray(0, 16);
  const blob  = ntResponse.subarray(16);
  const expected = hmacMd5(ntowfv2(USER, DOMAIN, PASSWORD), Buffer.concat([serverChallenge, blob]));
  return proof.equals(expected);
}

function authType(headerValue: string): 'type1' | 'type3' | null {
  const m = /^NTLM\s+(.+)$/i.exec(headerValue ?? '');
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.subarray(0, 8).equals(SIGNATURE)) return null;
  return buf.readUInt32LE(8) === 1 ? 'type1' : buf.readUInt32LE(8) === 3 ? 'type3' : null;
}

describe('performNtlmRequest — end-to-end against a real NTLM server', () => {
  let server: Server;
  let port: number;
  // Challenge is bound to the socket — this is what makes the test also verify
  // that message 3 arrives on the SAME connection as message 1.
  const challengeBySocket = new WeakMap<Socket, Buffer>();
  const targetInfo = Buffer.from('02000800430041000000', 'hex'); // tiny AV_PAIR block
  let sawSameSocket = false;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const auth = req.headers['authorization'] ?? '';
      const kind = authType(auth);

      const finish = () => {
        if (kind === 'type1') {
          const challenge = crypto.randomBytes(8);
          challengeBySocket.set(req.socket, challenge);
          res.writeHead(401, {
            'WWW-Authenticate': `NTLM ${buildType2(challenge, targetInfo)}`,
            'Content-Type': 'text/plain',
            Connection: 'keep-alive',
          });
          res.end('challenge');
          return;
        }
        if (kind === 'type3') {
          const challenge = challengeBySocket.get(req.socket);
          if (challenge) sawSameSocket = true;
          const token = /^NTLM\s+(.+)$/i.exec(auth)![1];
          const ok = !!challenge && verifyType3(Buffer.from(token, 'base64'), challenge);
          if (ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: true, method: req.method, scheme: 'ntlm' }));
          } else {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('bad credentials');
          }
          return;
        }
        // No NTLM header at all — demand it.
        res.writeHead(401, { 'WWW-Authenticate': 'NTLM', 'Content-Type': 'text/plain' });
        res.end('need ntlm');
      };

      // drain request body, then respond
      req.on('data', () => {});
      req.on('end', finish);
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('completes the handshake and authenticates (GET)', async () => {
    const resp = await performNtlmRequest({
      url: `http://127.0.0.1:${port}/secure`,
      method: 'GET',
      auth: { type: 'ntlm', username: USER, password: PASSWORD, ntlmDomain: DOMAIN, ntlmWorkstation: 'PC1' },
      vars: {},
      baseHeaders: { accept: 'application/json' },
    });

    expect(resp.status).toBe(200);
    const body = JSON.parse(await resp.text());
    expect(body.authenticated).toBe(true);
    expect(body.method).toBe('GET');
    expect(sawSameSocket).toBe(true); // message 3 reused message 1's connection
  });

  it('sends the body on the authenticate leg (POST)', async () => {
    const resp = await performNtlmRequest({
      url: `http://127.0.0.1:${port}/secure`,
      method: 'POST',
      auth: { type: 'ntlm', username: USER, password: PASSWORD, ntlmDomain: DOMAIN },
      vars: {},
      baseHeaders: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(resp.status).toBe(200);
    expect(JSON.parse(await resp.text()).method).toBe('POST');
  });

  it('returns 401 for a wrong password', async () => {
    const resp = await performNtlmRequest({
      url: `http://127.0.0.1:${port}/secure`,
      method: 'GET',
      auth: { type: 'ntlm', username: USER, password: 'wrong-password', ntlmDomain: DOMAIN },
      vars: {},
      baseHeaders: {},
    });
    expect(resp.status).toBe(401);
  });

  it('resolves credentials from interpolation vars', async () => {
    const resp = await performNtlmRequest({
      url: `http://127.0.0.1:${port}/secure`,
      method: 'GET',
      auth: { type: 'ntlm', username: '{{u}}', password: '{{p}}', ntlmDomain: '{{d}}' },
      vars: { u: USER, p: PASSWORD, d: DOMAIN },
      baseHeaders: {},
    });
    expect(resp.status).toBe(200);
  });

  it('rejects NTLM-over-proxy with a clear error', async () => {
    await expect(performNtlmRequest({
      url: `http://127.0.0.1:${port}/secure`,
      method: 'GET',
      auth: { type: 'ntlm', username: USER, password: PASSWORD },
      vars: {},
      baseHeaders: {},
      proxy: { url: 'http://localhost:8888' },
    })).rejects.toThrow(/proxy/i);
  });
});
