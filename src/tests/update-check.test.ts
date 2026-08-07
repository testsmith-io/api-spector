// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { isNewer } from '../main/update-check';

describe('isNewer', () => {
  it('detects a newer patch, minor, and major', () => {
    expect(isNewer('0.4.1', '0.4.0')).toBe(true);
    expect(isNewer('0.5.0', '0.4.9')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('is false for equal or older versions', () => {
    expect(isNewer('0.4.0', '0.4.0')).toBe(false);
    expect(isNewer('0.3.9', '0.4.0')).toBe(false);
    expect(isNewer('1.0.0', '1.0.1')).toBe(false);
  });

  it('ignores pre-release tags on the numeric core', () => {
    expect(isNewer('0.4.0-beta.1', '0.4.0')).toBe(false);
    expect(isNewer('0.4.1-rc.1', '0.4.0')).toBe(true);
  });
});
