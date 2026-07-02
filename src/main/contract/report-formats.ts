// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ContractReport, ContractResult } from '../../shared/types';

// ─── Report formatters ────────────────────────────────────────────────────────
// Machine-readable output so contract runs can gate CI pipelines.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function caseXml(r: ContractResult): string {
  const name    = escapeXml(`${r.method} ${r.requestName}`);
  const time    = ((r.durationMs ?? 0) / 1000).toFixed(3);
  const classnm = escapeXml(r.url);

  if (r.passed) {
    return `    <testcase name="${name}" classname="${classnm}" time="${time}"/>`;
  }
  const messages = r.violations.map(v => `${v.type}: ${v.message}${v.path ? ` (${v.path})` : ''}`);
  const summary  = escapeXml(messages[0] ?? 'contract failed');
  const detail   = escapeXml(messages.join('\n'));
  return [
    `    <testcase name="${name}" classname="${classnm}" time="${time}">`,
    `      <failure message="${summary}">${detail}</failure>`,
    `    </testcase>`,
  ].join('\n');
}

/** Render a ContractReport as JUnit XML (consumable by CI test reporters). */
export function toJUnitXml(report: ContractReport, suiteName = 'contract'): string {
  const time = (report.durationMs / 1000).toFixed(3);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="api-spector" tests="${report.total}" failures="${report.failed}" time="${time}">`,
    `  <testsuite name="${escapeXml(`${suiteName}:${report.mode}`)}" tests="${report.total}" failures="${report.failed}" time="${time}">`,
    ...report.results.map(caseXml),
    '  </testsuite>',
    '</testsuites>',
  ];
  return lines.join('\n') + '\n';
}
