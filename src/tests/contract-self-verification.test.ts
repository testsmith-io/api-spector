// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { parseSelfVerification } from '../main/cloud/self-verification';

describe('parseSelfVerification', () => {
  it('parses a passing JUnit report (aggregate testsuites)', () => {
    const xml = '<testsuites tests="5" failures="0" errors="0"><testsuite tests="5" failures="0"/></testsuites>';
    expect(parseSelfVerification(xml, 'report.xml')).toEqual({ success: true, total: 5, passed: 5, failed: 0, source: 'junit' });
  });

  it('counts failures + errors as failed', () => {
    const xml = '<testsuites tests="6" failures="1" errors="1"></testsuites>';
    expect(parseSelfVerification(xml, 'report.xml')).toEqual({ success: false, total: 6, passed: 4, failed: 2, source: 'junit' });
  });

  it('sums <testsuite> tags when there is no aggregate', () => {
    const xml = '<testsuite tests="2" failures="0"></testsuite><testsuite tests="3" failures="1"></testsuite>';
    expect(parseSelfVerification(xml, 'report.xml')).toEqual({ success: false, total: 5, passed: 4, failed: 1, source: 'junit' });
  });

  it('detects XML by content even without a .xml path', () => {
    const xml = '  <testsuites tests="1" failures="0"></testsuites>';
    expect(parseSelfVerification(xml, 'stdin')).toMatchObject({ success: true, source: 'junit' });
  });

  it('passes through JSON already in the broker shape', () => {
    expect(parseSelfVerification('{"success":true,"total":10,"source":"schemathesis"}', 'r.json'))
      .toEqual({ success: true, total: 10, source: 'schemathesis' });
  });

  it('derives success from JSON tests/failures', () => {
    expect(parseSelfVerification('{"tests":4,"failures":1}', 'r.json'))
      .toEqual({ success: false, total: 4, passed: 3, failed: 1, source: 'json' });
  });

  it('throws on unusable input', () => {
    expect(() => parseSelfVerification('not json, not xml', 'r.json')).toThrow();
    expect(() => parseSelfVerification('{"foo":1}', 'r.json')).toThrow();
  });
});
