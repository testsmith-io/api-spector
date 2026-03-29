// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect, afterEach } from 'vitest';
import { startMock, stopMock, isRunning, updateMockRoutes } from '../main/mock-server';
import type { MockServer, MockRoute } from '../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Ports are allocated sequentially to keep tests independent.
let portCounter = 19100;
function nextPort() { return portCounter++; }

async function hit(
  port: number,
  path: string,
  method = 'GET',
  body?: string,
): Promise<{ status: number; text: string }> {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  return { status: resp.status, text: await resp.text() };
}

function makeMock(port: number, routes: MockRoute[] = []): MockServer {
  return { version: '1.0', id: `mock-${port}`, name: 'Test', port, routes };
}

function makeRoute(overrides: Partial<MockRoute> & Pick<MockRoute, 'path'>): MockRoute {
  return {
    id:         overrides.path,
    method:     'GET',
    statusCode: 200,
    headers:    {},
    body:       '',
    ...overrides,
  };
}

// Track servers so we can always stop them after each test.
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.map(id => isRunning(id) ? stopMock(id) : Promise.resolve()));
  cleanup.length = 0;
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe('mock server lifecycle', () => {
  it('isRunning returns false before start', () => {
    expect(isRunning('never-started')).toBe(false);
  });

  it('isRunning returns true after start and false after stop', async () => {
    const mock = makeMock(nextPort());
    cleanup.push(mock.id);
    await startMock(mock);
    expect(isRunning(mock.id)).toBe(true);
    await stopMock(mock.id);
    expect(isRunning(mock.id)).toBe(false);
  });

  it('stopMock is a no-op for an unknown id', async () => {
    await expect(stopMock('unknown-id')).resolves.toBeUndefined();
  });

  it('starting the same server twice replaces the first instance', async () => {
    const mock = makeMock(nextPort());
    cleanup.push(mock.id);
    await startMock(mock);
    // Second start on same ID — should not throw
    await startMock(mock);
    expect(isRunning(mock.id)).toBe(true);
  });
});

// ─── Route matching ───────────────────────────────────────────────────────────

describe('mock server: route matching', () => {
  it('returns 404 JSON for an unmatched route', async () => {
    const mock = makeMock(nextPort());
    cleanup.push(mock.id);
    await startMock(mock);
    const r = await hit(mock.port, '/nothing');
    expect(r.status).toBe(404);
    expect(JSON.parse(r.text).error).toMatch(/No matching/i);
  });

  it('matches an exact static path', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/ping', statusCode: 200, body: 'pong' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    const r = await hit(port, '/ping');
    expect(r.status).toBe(200);
    expect(r.text).toBe('pong');
  });

  it('matches a parameterized path segment', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/users/:id', statusCode: 200, body: 'user' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/users/42')).status).toBe(200);
    expect((await hit(port, '/users/abc')).status).toBe(200);
  });

  it('does not match a shorter path against a parameterized route', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/users/:id', statusCode: 200, body: '' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    // /users alone should not match /users/:id
    expect((await hit(port, '/users')).status).toBe(404);
  });

  it('matches ANY method for GET, POST, and DELETE', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ method: 'ANY', path: '/flex', statusCode: 204, body: '' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/flex', 'GET')).status).toBe(204);
    expect((await hit(port, '/flex', 'POST', '{}')).status).toBe(204);
    expect((await hit(port, '/flex', 'DELETE')).status).toBe(204);
  });

  it('prefers a method-specific route over ANY for the same path', async () => {
    const port = nextPort();
    const mock = makeMock(port, [
      makeRoute({ method: 'GET',  path: '/data', statusCode: 200, body: 'specific' }),
      makeRoute({ method: 'ANY', path: '/data', statusCode: 201, body: 'any' }),
    ]);
    cleanup.push(mock.id);
    await startMock(mock);
    const r = await hit(port, '/data', 'GET');
    expect(r.text).toBe('specific');
    expect(r.status).toBe(200);
  });

  it('returns configured status code', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/created', method: 'POST', statusCode: 201, body: '{}' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/created', 'POST', '{}')).status).toBe(201);
  });

  it('returns 204 for /favicon.ico (browser noise suppression)', async () => {
    const mock = makeMock(nextPort());
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(mock.port, '/favicon.ico')).status).toBe(204);
  });
});

// ─── Live route updates ───────────────────────────────────────────────────────

describe('mock server: live route updates', () => {
  it('reflects updated routes without restarting the server', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/live', statusCode: 200, body: 'v1' })]);
    cleanup.push(mock.id);
    await startMock(mock);

    expect((await hit(port, '/live')).text).toBe('v1');

    updateMockRoutes(mock.id, [makeRoute({ path: '/live', statusCode: 200, body: 'v2' })]);

    expect((await hit(port, '/live')).text).toBe('v2');
  });
});

// ─── Body interpolation ───────────────────────────────────────────────────────

describe('mock server: body interpolation', () => {
  it('interpolates {{request.params.id}} from URL path parameter', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/items/:id', body: '{"id":"{{request.params.id}}"}',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    const parsed = JSON.parse((await hit(port, '/items/99')).text);
    expect(parsed.id).toBe('99');
  });

  it('interpolates {{request.query.q}} from query string', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/search', body: '{"q":"{{request.query.q}}"}' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    const parsed = JSON.parse((await hit(port, '/search?q=hello')).text);
    expect(parsed.q).toBe('hello');
  });

  it('interpolates {{request.method}}', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ method: 'ANY', path: '/method', body: '{{request.method}}' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/method', 'POST', '{}')).text).toBe('POST');
  });

  it('leaves an unresolvable {{token}} unchanged in the body', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({ path: '/t', body: '{{unknownToken}}' })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/t')).text).toBe('{{unknownToken}}');
  });

  it('handles multiple tokens in the same body', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/multi/:a/:b',
      body: '{"a":"{{request.params.a}}","b":"{{request.params.b}}"}',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    const parsed = JSON.parse((await hit(port, '/multi/foo/bar')).text);
    expect(parsed).toEqual({ a: 'foo', b: 'bar' });
  });
});

// ─── Pre-response scripts ─────────────────────────────────────────────────────

describe('mock server: pre-response scripts', () => {
  it('script can override the response status code', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/teapot', statusCode: 200, body: 'ok',
      script: 'response.statusCode = 418;',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/teapot')).status).toBe(418);
  });

  it('script can override the response body', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/scripted', statusCode: 200, body: 'original',
      script: 'response.body = "from-script";',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/scripted')).text).toBe('from-script');
  });

  it('script can access request.params', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/greet/:name', statusCode: 200, body: '',
      script: 'response.body = "Hello, " + request.params.name + "!";',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/greet/world')).text).toBe('Hello, world!');
  });

  it('script can access request.query', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/qs', statusCode: 200, body: '',
      script: 'response.body = request.query.x;',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/qs?x=42')).text).toBe('42');
  });

  it('a script error does not crash the server — response falls back to route defaults', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/buggy', statusCode: 200, body: 'safe-fallback',
      script: 'throw new Error("oops");',
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    const r = await hit(port, '/buggy');
    expect(r.status).toBe(200);
    expect(r.text).toBe('safe-fallback');
  });

  it('script can implement conditional 404', async () => {
    const port = nextPort();
    const mock = makeMock(port, [makeRoute({
      path: '/items/:id', statusCode: 200, body: 'found',
      script: `
        const valid = ['1', '2', '3'];
        if (!valid.includes(request.params.id)) {
          response.statusCode = 404;
          response.body = 'not found';
        }
      `,
    })]);
    cleanup.push(mock.id);
    await startMock(mock);
    expect((await hit(port, '/items/1')).status).toBe(200);
    expect((await hit(port, '/items/99')).status).toBe(404);
  });
});
