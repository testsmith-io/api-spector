// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from 'vitest';
import { entriesToMockServer } from '../main/recorder';
import type { RecordedEntry } from '../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
  method: string,
  path: string,
  status: number,
  body: string | null = null,
  headers: Record<string, string> = {},
  binary = false,
): RecordedEntry {
  return {
    id:         `${method}-${path}-${status}`,
    timestamp:  '2026-01-01T00:00:00.000Z',
    durationMs: 50,
    request:    { method, path, query: {}, headers: {}, body: null },
    response:   { status, statusText: String(status), headers, body, binary, bodySize: body?.length ?? 0 },
  };
}

// ─── entriesToMockServer ──────────────────────────────────────────────────────

describe('entriesToMockServer', () => {
  it('returns empty routes for empty input', () => {
    const server = entriesToMockServer([], 'https://api.example.com', 'Empty', 3000);
    expect(server.routes).toHaveLength(0);
  });

  it('creates one route per unique method+path combination', () => {
    const entries = [
      makeEntry('GET',  '/users',    200, '[]'),
      makeEntry('POST', '/users',    201, '{"id":1}'),
      makeEntry('GET',  '/products', 200, '[]'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes).toHaveLength(3);
  });

  it('deduplicates same method+path to a single route', () => {
    const entries = [
      makeEntry('GET', '/users', 200, 'first'),
      makeEntry('GET', '/users', 200, 'second'),
      makeEntry('GET', '/users', 200, 'third'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes).toHaveLength(1);
  });

  // ── Deduplication preference ──────────────────────────────────────────────

  it('keeps the first 2xx response and discards subsequent non-2xx', () => {
    const entries = [
      makeEntry('GET', '/data', 200, 'good-response'),
      makeEntry('GET', '/data', 500, 'server-error'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].statusCode).toBe(200);
    expect(server.routes[0].body).toBe('good-response');
  });

  it('promotes a later 2xx over an earlier non-2xx', () => {
    const entries = [
      makeEntry('POST', '/login', 401, 'bad-creds'),
      makeEntry('POST', '/login', 200, 'welcome'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].statusCode).toBe(200);
    expect(server.routes[0].body).toBe('welcome');
  });

  it('keeps the last entry when no 2xx is recorded for that endpoint', () => {
    const entries = [
      makeEntry('GET', '/gone', 404, 'first-404'),
      makeEntry('GET', '/gone', 503, 'last-503'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].statusCode).toBe(503);
    expect(server.routes[0].body).toBe('last-503');
  });

  it('does not replace an existing 2xx with a later 2xx (first wins)', () => {
    const entries = [
      makeEntry('GET', '/items', 200, 'original-200'),
      makeEntry('GET', '/items', 201, 'later-201'),
    ];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].body).toBe('original-200');
  });

  // ── Binary content ────────────────────────────────────────────────────────

  it('replaces binary body with a human-readable placeholder', () => {
    const entries = [makeEntry('GET', '/logo.png', 200, 'base64:abc==', {}, true)];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].body).toMatch(/^\[binary/);
    expect(server.routes[0].body).not.toContain('base64:');
  });

  it('placeholder includes the upstream URL and path', () => {
    const entries = [makeEntry('GET', '/img.png', 200, 'base64:x', {}, true)];
    const server = entriesToMockServer(entries, 'https://cdn.example.com', 'T', 3000);
    expect(server.routes[0].body).toContain('https://cdn.example.com');
    expect(server.routes[0].body).toContain('/img.png');
  });

  // ── Header filtering ──────────────────────────────────────────────────────

  it('strips connection, content-length, and transfer-encoding headers', () => {
    const entries = [makeEntry('GET', '/api', 200, '{}', {
      'content-type':      'application/json',
      'content-length':    '2',
      'connection':        'keep-alive',
      'transfer-encoding': 'chunked',
    })];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    const h = server.routes[0].headers;
    expect(h['content-type']).toBe('application/json');
    expect(h['content-length']).toBeUndefined();
    expect(h['connection']).toBeUndefined();
    expect(h['transfer-encoding']).toBeUndefined();
  });

  it('strips CDN and HSTS headers (cf-ray, strict-transport-security, alt-svc)', () => {
    const entries = [makeEntry('GET', '/api', 200, '{}', {
      'cf-ray':                   '12345-LHR',
      'cf-cache-status':          'HIT',
      'strict-transport-security': 'max-age=31536000',
      'alt-svc':                  'h3=":443"',
      'content-type':             'application/json',
    })];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    const h = server.routes[0].headers;
    expect(h['cf-ray']).toBeUndefined();
    expect(h['cf-cache-status']).toBeUndefined();
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['alt-svc']).toBeUndefined();
    expect(h['content-type']).toBe('application/json');
  });

  it('strips content-encoding header', () => {
    const entries = [makeEntry('GET', '/api', 200, 'body', {
      'content-encoding': 'gzip',
      'x-custom':         'keep-me',
    })];
    const server = entriesToMockServer(entries, 'https://api.example.com', 'T', 3000);
    expect(server.routes[0].headers['content-encoding']).toBeUndefined();
    expect(server.routes[0].headers['x-custom']).toBe('keep-me');
  });

  // ── Server metadata ───────────────────────────────────────────────────────

  it('sets name and port from arguments', () => {
    const server = entriesToMockServer([], 'https://api.example.com', 'My Server', 8080);
    expect(server.name).toBe('My Server');
    expect(server.port).toBe(8080);
  });

  it('assigns version 1.0 and a non-empty id', () => {
    const server = entriesToMockServer([], 'https://api.example.com', 'T', 3000);
    expect(server.version).toBe('1.0');
    expect(server.id).toBeTruthy();
  });

  it('assigns a unique id on each call', () => {
    const s1 = entriesToMockServer([], 'https://api.example.com', 'T', 3000);
    const s2 = entriesToMockServer([], 'https://api.example.com', 'T', 3000);
    expect(s1.id).not.toBe(s2.id);
  });

  it('sets description containing the upstream URL', () => {
    const entries = [makeEntry('GET', '/test', 200, '{}')];
    const server = entriesToMockServer(entries, 'https://backend.internal', 'T', 3000);
    expect(server.routes[0].description).toContain('https://backend.internal');
  });
});
