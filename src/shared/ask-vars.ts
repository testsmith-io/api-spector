// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// "Ask variables" — values you are prompted for at send time instead of storing
// them. Written as {{@Message}} anywhere a variable is allowed, or
// {{@Message[one, two, three]}} to pick from a fixed list (a dropdown). They are
// never saved, so they suit a one-off value or a secret you do not want on disk.
//
// On an interactive send the UI asks for each one; in an automated run (the CLI)
// they come from --ask "Message=value", and a request whose ask variables are
// not supplied is skipped. This module is pure (no DOM / Electron) so both the
// renderer and the main/CLI side share the exact same parsing.

import type { ApiRequest } from './types';

export interface AskVar {
  /** The exact token inner, including the leading @, used as the interpolation
   *  key (e.g. "@Region[eu, us]"). */
  key: string
  /** The message shown when prompting (e.g. "Region"). */
  message: string
  /** Fixed choices, when written as {{@Msg[a, b]}} — rendered as a dropdown. */
  choices?: string[]
}

// {{@...}} — an ask token. The inner (after @) is captured.
const ASK_RE = /\{\{\s*@([^}]+?)\s*\}\}/g;

function parseInner(inner: string): { message: string; choices?: string[] } {
  const m = /^(.*?)\[([^\]]*)\]\s*$/.exec(inner);
  if (m) {
    const choices = m[2].split(',').map(s => s.trim()).filter(Boolean);
    return { message: m[1].trim(), choices: choices.length ? choices : undefined };
  }
  return { message: inner.trim() };
}

/** Extract the unique ask variables found across the given text fields, keyed by
 *  their exact token (so the same message with different choices stays distinct,
 *  and repeats are prompted once). */
export function extractAskVars(texts: (string | undefined)[]): AskVar[] {
  const seen = new Map<string, AskVar>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(ASK_RE)) {
      const inner = m[1].trim();
      const key = `@${inner}`;
      if (seen.has(key)) continue;
      const { message, choices } = parseInner(inner);
      if (!message) continue;
      seen.set(key, { key, message, choices });
    }
  }
  return [...seen.values()];
}

/** All ask variables referenced anywhere in a request (URL, params, headers,
 *  body, auth). */
export function askVarsInRequest(req: ApiRequest): AskVar[] {
  const texts: (string | undefined)[] = [req.url];
  for (const p of req.params ?? []) texts.push(p.key, p.value);
  for (const h of req.headers ?? []) texts.push(h.key, h.value);
  const b = req.body;
  if (b) {
    texts.push(b.json, b.raw);
    if (b.graphql) texts.push(b.graphql.query, b.graphql.variables);
    for (const f of b.form ?? []) texts.push(f.key, f.value);
    if (b.soap) texts.push(b.soap.envelope);
    if (b.grpc) texts.push(b.grpc.message);
  }
  try { texts.push(JSON.stringify(req.auth ?? {})); } catch { /* ignore */ }
  return extractAskVars(texts);
}

/** Build the interpolation map ({token → value}) from answers keyed by message.
 *  A missing answer becomes an empty string (matching the blank-input rule). */
export function resolveAskValues(asks: AskVar[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of asks) out[a.key] = answers[a.message] ?? '';
  return out;
}

/** Ask messages that have no answer in the provided map — used by the CLI to
 *  decide whether a request must be skipped in a non-interactive run. */
export function missingAskMessages(asks: AskVar[], answers: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const a of asks) if (!(a.message in answers) && !missing.includes(a.message)) missing.push(a.message);
  return missing;
}
