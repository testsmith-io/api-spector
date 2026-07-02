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
}

/** Decide whether a pacticipant version is safe to deploy based on the last
 *  recorded verification. Unknown versions are NOT deployable (fail closed). */
export async function canIDeploy(
  dir: string,
  pacticipant: string,
  version: string,
): Promise<CanIDeployVerdict> {
  const file = resultPath(dir, pacticipant, version);
  let record: RecordedResult;
  try {
    record = JSON.parse(await readFile(file, 'utf8')) as RecordedResult;
  } catch {
    return {
      deployable: false,
      reason: `No verification result recorded for ${pacticipant}@${version}. Run \`contract run … --record --pacticipant ${pacticipant} --app-version ${version}\` first.`,
    };
  }
  if (record.passed) {
    return {
      deployable: true,
      reason: `${pacticipant}@${version} passed all ${record.report.total} contract checks (verified ${record.recordedAt}).`,
      record,
    };
  }
  return {
    deployable: false,
    reason: `${pacticipant}@${version} has ${record.report.failed}/${record.report.total} failing contract checks (verified ${record.recordedAt}).`,
    record,
  };
}
