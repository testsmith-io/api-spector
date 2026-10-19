// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// End-to-end tests of the realtime test engine (runWsTest / runSocketIoTest /
// runGraphqlWsTest) against in-process servers: connect, (optionally) send,
// collect, and assert over sp.messages.
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { Server as IoServer } from 'socket.io';
import { runWsTest, runSocketIoTest, runGraphqlWsTest } from '../main/realtime-test';

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// ─── WebSocket ────────────────────────────────────────────────────────────

describe('runWsTest', () => {
  function startWsServer(): Promise<string> {
    const wss = new WebSocketServer({ port: 0 });
    cleanups.push(() => wss.close());
    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'welcome' }));
      let n = 0;
      const timer = setInterval(() => { n += 1; socket.send(JSON.stringify({ type: 'tick', n })); }, 80);
      socket.on('message', (d) => socket.send(`echo: ${d.toString()}`));
      socket.on('close', () => clearInterval(timer));
    });
    return new Promise(r => wss.on('listening', () => r(`ws://localhost:${(wss.address() as AddressInfo).port}`)));
  }

  it('collects frames and asserts over sp.messages', async () => {
    const url = await startWsServer();
    const res = await runWsTest({
      url, collectMs: 400,
      script: `sp.test('a tick arrives', () => {
        const m = sp.messages.find(m => m.json().type === 'tick');
        sp.expect(m).to.exist;
        sp.expect(m.json().n).to.be.a('number');
      });`,
    });
    expect(res.error).toBeUndefined();
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.testResults[0].passed).toBe(true);
  });

  it('sends a message on open and sees it echoed back', async () => {
    const url = await startWsServer();
    const res = await runWsTest({
      url, sendMessage: 'ping', collectMs: 300,
      script: `sp.test('echo came back', () => {
        sp.expect(sp.messages.some(m => m.text() === 'echo: ping')).to.equal(true);
      });`,
    });
    expect(res.testResults[0].passed).toBe(true);
  });

  it('errors for an unreachable server', async () => {
    const res = await runWsTest({ url: 'ws://localhost:1', collectMs: 300, script: `sp.test('noop', () => sp.expect(true).to.equal(true));` });
    expect(res.error).toBeDefined();
    expect(res.testResults).toHaveLength(0);
  });
});

// ─── Socket.IO ──────────────────────────────────────────────────────────────

describe('runSocketIoTest', () => {
  function startIoServer(): Promise<string> {
    const httpServer = http.createServer();
    const io = new IoServer(httpServer, { cors: { origin: '*' } });
    cleanups.push(() => { io.close(); httpServer.close(); });
    io.on('connection', (socket) => {
      socket.emit('welcome', { id: socket.id });
      let n = 0;
      const timer = setInterval(() => { n += 1; socket.emit('tick', { n }); }, 80);
      socket.on('echo', (payload) => socket.emit('echo:reply', payload));
      socket.on('disconnect', () => clearInterval(timer));
    });
    return new Promise(r => httpServer.listen(0, () => r(`http://localhost:${(httpServer.address() as AddressInfo).port}`)));
  }

  it('collects events and asserts over sp.messages', async () => {
    const url = await startIoServer();
    const res = await runSocketIoTest({
      url, collectMs: 400,
      script: `sp.test('a tick event arrives', () => {
        const m = sp.messages.find(m => m.event === 'tick');
        sp.expect(m).to.exist;
        sp.expect(m.json().n).to.be.a('number');
      });`,
    });
    expect(res.error).toBeUndefined();
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.testResults[0].passed).toBe(true);
  });

  it('emits an event on connect and sees the reply', async () => {
    const url = await startIoServer();
    const res = await runSocketIoTest({
      url, emitEvent: 'echo', emitArgs: '{"ping":1}', collectMs: 300,
      script: `sp.test('reply came back', () => {
        const m = sp.messages.find(m => m.event === 'echo:reply');
        sp.expect(m).to.exist;
        sp.expect(m.json().ping).to.equal(1);
      });`,
    });
    expect(res.testResults[0].passed).toBe(true);
  });
});

// ─── GraphQL subscriptions (graphql-ws protocol) ──────────────────────────────

describe('runGraphqlWsTest', () => {
  // Minimal graphql-transport-ws server over `ws`: ack, then stream `next`.
  function startGqlServer(): Promise<string> {
    const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'graphql-transport-ws' });
    cleanups.push(() => wss.close());
    wss.on('connection', (socket) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }));
        else if (msg.type === 'subscribe') {
          let n = 0;
          timer = setInterval(() => { n += 1; socket.send(JSON.stringify({ id: msg.id, type: 'next', payload: { data: { randomNumber: n } } })); }, 80);
        } else if (msg.type === 'complete') { if (timer) clearInterval(timer); }
      });
      socket.on('close', () => { if (timer) clearInterval(timer); });
    });
    return new Promise(r => wss.on('listening', () => r(`ws://localhost:${(wss.address() as AddressInfo).port}`)));
  }

  it('collects subscription payloads and asserts over sp.messages', async () => {
    const url = await startGqlServer();
    const res = await runGraphqlWsTest({
      url, query: 'subscription { randomNumber }', collectMs: 400,
      script: `sp.test('a payload arrives', () => {
        const m = sp.messages[0];
        sp.expect(m).to.exist;
        sp.expect(m.json()).to.have.property('randomNumber');
      });`,
    });
    expect(res.error).toBeUndefined();
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.testResults[0].passed).toBe(true);
  });

  it('errors for an unreachable server', async () => {
    const res = await runGraphqlWsTest({ url: 'ws://localhost:1', query: 'subscription { x }', collectMs: 300, script: `sp.test('noop', () => sp.expect(true).to.equal(true));` });
    expect(res.error).toBeDefined();
  });
});
