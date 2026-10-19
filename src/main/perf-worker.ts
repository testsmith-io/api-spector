// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Load-generation worker. Runs in an Electron utilityProcess (a dedicated Node
// process) so the main process event loop stays responsive while a heavy run is
// in flight. The engine is pure Node (undici, vm, the flow engine), so it runs
// here unchanged. The main process resolves env vars (OS keychain) and passes
// them in via `resolvedEnvVars`, so this process never touches the keychain;
// inline {{vault:…}} references use the HTTP-based secret providers, configured
// here from the passed secretsConfig.
//
// Protocol (over process.parentPort):
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
