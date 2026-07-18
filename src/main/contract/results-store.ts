// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import type { ContractReport } from '../../shared/types';

// ─── Verification results store (local can-i-deploy) ──────────────────────────
//
// A lightweight, broker-free deployment gate. After a verification run, record
// the report keyed by pacticipant + version under
// `<workspace>/contracts/results/<pacticipant>/<version>.json`. `can-i-deploy`
// then reads the recorded report and answers whether that version is safe to
// ship (i.e. its last contract verification passed).
//
// This is intentionally local-first — no Pact Broker required — but mirrors the
// same mental model so teams can graduate to a shared store later.

const RESULTS_DIR = 'contracts/results';

export interface RecordedResult {
  pacticipant: string
  version: string
  recordedAt: string
  passed: boolean
  report: ContractReport
}

function safe(part: string): string {
  return part.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function resultPath(dir: string, pacticipant: string, version: string): string {
  return join(dir, RESULTS_DIR, safe(pacticipant), `${safe(version)}.json`);
}

/** Persist a verification report for a pacticipant version. */
export async function recordResult(
  dir: string,
  pacticipant: string,
  version: string,
  report: ContractReport,
  now: string,
): Promise<string> {
  const file = resultPath(dir, pacticipant, version);
  await mkdir(join(dir, RESULTS_DIR, safe(pacticipant)), { recursive: true });
  const record: RecordedResult = {
    pacticipant,
    version,
    recordedAt: now,
    passed: report.failed === 0,
    report,
  };
  await writeFile(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}

/** Load every recorded verification result in the workspace (for dashboards). */
export async function listResults(dir: string): Promise<RecordedResult[]> {
  const root = join(dir, RESULTS_DIR);
  const out: RecordedResult[] = [];
  let pacticipants: string[];
  try {
    pacticipants = await readdir(root);
  } catch {
    return out; // no results dir yet
  }
  for (const p of pacticipants) {
    let files: string[];
    try {
      files = await readdir(join(root, p));
    } catch {
      continue; // not a directory
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await readFile(join(root, p, f), 'utf8')) as RecordedResult);
      } catch { /* skip unreadable */ }
    }
  }
  return out;
}

export interface CanIDeployVerdict {
  deployable: boolean
  reason: string
  record?: RecordedResult
  /** When checking against an environment: what that env currently runs. */
  currentlyDeployed?: DeploymentRecord
}

/** Decide whether a pacticipant version is safe to deploy based on the last
 *  recorded verification. Unknown versions are NOT deployable (fail closed).
 *  With `env`, the verdict also reports what that environment currently runs
 *  so pipelines can log the upgrade they are about to perform. */
export async function canIDeploy(
  dir: string,
  pacticipant: string,
  version: string,
  env?: string,
): Promise<CanIDeployVerdict> {
  const file = resultPath(dir, pacticipant, version);
  let currentlyDeployed: DeploymentRecord | undefined;
  if (env) {
    const state = await loadEnvironment(dir, env);
    currentlyDeployed = state?.deployed[pacticipant];
  }
  let record: RecordedResult;
  try {
    record = JSON.parse(await readFile(file, 'utf8')) as RecordedResult;
  } catch {
    return {
      deployable: false,
      reason: `No verification result recorded for ${pacticipant}@${version}. Run \`contract run … --record --pacticipant ${pacticipant} --app-version ${version}\` first.`,
      currentlyDeployed,
    };
  }
  if (record.passed) {
    return {
      deployable: true,
      reason: `${pacticipant}@${version} passed all ${record.report.total} contract checks (verified ${record.recordedAt}).`,
      record,
      currentlyDeployed,
    };
  }
  return {
    deployable: false,
    reason: `${pacticipant}@${version} has ${record.report.failed}/${record.report.total} failing contract checks (verified ${record.recordedAt}).`,
    record,
    currentlyDeployed,
  };
}

// ─── Environment / deployment tracking ────────────────────────────────────────
//
// Records which pacticipant version is deployed in which environment, as
// plain files under `<workspace>/contracts/environments/<env>.json`. Committed
// to git like results, so "what runs in prod" has history and needs no server.
// Recording documents a fact (the deploy happened), so it never gates; gating
// belongs to can-i-deploy BEFORE the deploy.

const ENV_DIR = 'contracts/environments';

export interface DeploymentRecord {
  version: string
  recordedAt: string
}

export interface EnvironmentState {
  name: string
  /** Current deployment per pacticipant. A new deploy replaces the entry. */
  deployed: Record<string, DeploymentRecord>
}

function envPath(dir: string, env: string): string {
  return join(dir, ENV_DIR, `${safe(env)}.json`);
}

async function loadEnvironment(dir: string, env: string): Promise<EnvironmentState | null> {
  try {
    return JSON.parse(await readFile(envPath(dir, env), 'utf8')) as EnvironmentState;
  } catch {
    return null;
  }
}

/** Record that a pacticipant version is now deployed in an environment.
 *  Returns the file written and the previous deployment, if any. */
export async function recordDeployment(
  dir: string,
  env: string,
  pacticipant: string,
  version: string,
  now: string,
): Promise<{ file: string; previous?: DeploymentRecord }> {
  const state = (await loadEnvironment(dir, env)) ?? { name: env, deployed: {} };
  const previous = state.deployed[pacticipant];
  state.deployed[pacticipant] = { version, recordedAt: now };
  await mkdir(join(dir, ENV_DIR), { recursive: true });
  const file = envPath(dir, env);
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  return { file, previous };
}

/** All environments with their current deployments (for dashboards). */
export async function listEnvironments(dir: string): Promise<EnvironmentState[]> {
  const root = join(dir, ENV_DIR);
  let files: string[];
  try {
    files = await readdir(root);
  } catch {
    return [];
  }
  const out: EnvironmentState[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await readFile(join(root, f), 'utf8')) as EnvironmentState);
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
