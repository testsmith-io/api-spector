// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Parse a provider self-verification report (the outcome of running the
 * provider's own tests against its OpenAPI spec) into the shape the broker
 * stores alongside the spec: { success, total, passed, failed, source }.
 *
 * Accepts JUnit XML (Postman/newman, Schemathesis, pytest, …) or JSON. JSON that
 * already carries a boolean `success` is passed through; otherwise a numeric
 * `total`/`tests` (+ optional `failed`/`failures`) is used to derive it.
 *
 * Throws on unparseable input.
 */
export function parseSelfVerification(text: string, path: string): Record<string, unknown> {
  const trimmed = text.trimStart();
  const isXml = path.toLowerCase().endsWith('.xml') || trimmed.startsWith('<');

  if (isXml) {
    const num = (tag: string, name: string): number => {
      const m = tag.match(new RegExp(`\\b${name}="(\\d+(?:\\.\\d+)?)"`));
      return m ? Math.round(Number(m[1])) : 0;
    };
    // Prefer the aggregate <testsuites> tag; otherwise sum every <testsuite>.
    const agg = text.match(/<testsuites\b[^>]*>/);
    let tests = 0, failures = 0, errors = 0;
    if (agg) {
      tests = num(agg[0], 'tests'); failures = num(agg[0], 'failures'); errors = num(agg[0], 'errors');
    }
    if (!tests) {
      for (const t of text.match(/<testsuite\b[^>]*>/g) ?? []) {
        tests += num(t, 'tests'); failures += num(t, 'failures'); errors += num(t, 'errors');
      }
    }
    const failed = failures + errors;
    return { success: failed === 0, total: tests, passed: tests - failed, failed, source: 'junit' };
  }

  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Could not parse the results file (expected JUnit XML or JSON).');
  }
  if (typeof o.success === 'boolean') return o; // already in our shape
  const total = (o.total ?? o.tests) as number | undefined;
  const failed = (o.failed ?? o.failures ?? 0) as number;
  if (typeof total === 'number') {
    return { success: failed === 0, total, passed: total - failed, failed, source: o.source ?? 'json' };
  }
  throw new Error('Could not read the results file: JSON needs a boolean `success` or a numeric `total`/`tests`.');
}
