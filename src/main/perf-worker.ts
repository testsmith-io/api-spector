// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Load-generation worker in an Electron utilityProcess (keeps the main loop
// responsive). The worker never touches the keychain; the main process passes
// resolved env vars in, and inline {{vault:...}} refs use secretsConfig providers.
//
// Protocol (process.parentPort):
//   in : { type: 'run', payload } | { type: 'stop' }
//   out: { type: 'progress', p } | { type: 'result', result } | { type: 'error', message }

import { runPerfPlan, type PerfRunPayload } from './perf-run';
import { stopPerfRun } from './perf-runner';
import { setSecretsConfig } from './secrets';

// process.parentPort is injected by Electron in a utilityProcess.
const port = (process as unknown as { parentPort: { on: (ev: string, cb: (e: { data: unknown }) => void) => void; postMessage: (m: unknown) => void } }).parentPort;

port.on('message', (e) => {
  const msg = e.data as { type: string; payload?: PerfRunPayload };
  if (msg.type === 'stop') { stopPerfRun(); return; }
  if (msg.type !== 'run' || !msg.payload) return;
  void (async () => {
    try {
      if (msg.payload!.secretsConfig) setSecretsConfig(msg.payload!.secretsConfig);
      const result = await runPerfPlan(msg.payload!, (p) => port.postMessage({ type: 'progress', p }));
      port.postMessage({ type: 'result', result });
    } catch (err) {
      port.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
});
