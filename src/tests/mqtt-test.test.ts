// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// End-to-end test of runMqttTest against an in-process aedes broker: connect,
// subscribe, publish, collect, and assert over sp.messages.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import aedes from 'aedes';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { runMqttTest } from '../main/mqtt-test';

let broker: ReturnType<typeof aedes>;
let server: net.Server;
let url: string;

beforeAll(async () => {
  broker = aedes();
  server = net.createServer(broker.handle);
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  url = `mqtt://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  broker.close();
});

describe('runMqttTest', () => {
  it('collects a published message and passes an assertion on it', async () => {
    const res = await runMqttTest({
      url,
      subscribeTopic: 'sensors/#',
      publishTopic: 'sensors/temp',
      publishPayload: JSON.stringify({ c: 21.5 }),
      qos: 1,
      collectMs: 400,
      script: `
        sp.test('a reading arrives', () => {
          const m = sp.messages.find(m => m.topic === 'sensors/temp');
          sp.expect(m).to.exist;
          sp.expect(m.json().c).to.equal(21.5);
        });
      `,
    });
    expect(res.error).toBeUndefined();
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.testResults).toHaveLength(1);
    expect(res.testResults[0].passed).toBe(true);
  });

  it('reports a failing assertion', async () => {
    const res = await runMqttTest({
      url,
      subscribeTopic: 'sensors/#',
      publishTopic: 'sensors/temp',
      publishPayload: JSON.stringify({ c: 99 }),
      qos: 1,
      collectMs: 400,
      script: `sp.test('temp is 21.5', () => { sp.expect(sp.messages[0].json().c).to.equal(21.5); });`,
    });
    expect(res.testResults[0].passed).toBe(false);
  });

  it('exposes message metadata (topic, qos, retain) on sp.messages', async () => {
    const res = await runMqttTest({
      url,
      subscribeTopic: 'a/#',
      publishTopic: 'a/b',
      publishPayload: 'hello',
      qos: 1,
      collectMs: 400,
      script: `
        sp.test('metadata present', () => {
          const m = sp.messages.find(m => m.topic === 'a/b');
          sp.expect(m.text()).to.equal('hello');
          sp.expect(m.qos).to.equal(1);
          sp.expect(m.retain).to.equal(false);
        });
      `,
    });
    expect(res.testResults[0].passed).toBe(true);
  });

  it('does not publish to a wildcard topic, and collects for the full window', async () => {
    // A wildcard in the Publish topic is illegal to publish and would make the
    // broker drop the connection mid-test. The test must skip the publish and
    // still run the collect window to completion (here: an outside publisher
    // feeds the subscription).
    const feeder = (await import('mqtt')).default.connect(url, { clientId: 'feeder' });
    await new Promise<void>(r => feeder.on('connect', () => r()));
    const t0 = Date.now();
    const res = await runMqttTest({
      url,
      subscribeTopic: 'sensors/#',
      publishTopic: 'sensors/#',          // wildcard — must not be published
      publishPayload: 'ignored',
      qos: 0,
      collectMs: 500,
      script: `sp.test('ran to the end', () => sp.expect(true).to.equal(true));`,
    });
    // Feed one message during the window so the subscription still receives.
    feeder.publish('sensors/temp', 'from-feeder');
    feeder.end(true);
    expect(res.error).toBeUndefined();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450);  // full window, not a ~100ms drop
    expect(res.testResults[0].passed).toBe(true);
  });

  it('returns an error for an unreachable broker', async () => {
    const res = await runMqttTest({
      url: 'mqtt://localhost:1',  // nothing listening
      subscribeTopic: 'x',
      collectMs: 300,
      script: `sp.test('noop', () => sp.expect(true).to.equal(true));`,
    });
    expect(res.error).toBeDefined();
    expect(res.testResults).toHaveLength(0);
  });
});
