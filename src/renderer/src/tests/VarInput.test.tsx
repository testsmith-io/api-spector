// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Regression test for VarInput: a variable value can arrive as null/undefined
// (an empty Collection Variables cell, or data imported from another tool).
// The component must coerce it instead of throwing
// "Cannot read properties of null (reading 'matchAll')" from parseVarTokens.
//
// Run with: npx vitest --project renderer

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Keep the component hermetic — no real store behind the scope hooks / i18n.
vi.mock('../hooks/useVarNames', () => ({ useVarNames: () => ['baseUrl'] }));
vi.mock('../hooks/useVarValues', () => ({ useVarValues: () => ({ baseUrl: 'https://x.test' }) }));
vi.mock('../i18n', () => ({ useT: () => (s: string) => s }));

import { VarInput } from '../components/common/VarInput';

afterEach(cleanup);

describe('VarInput null-safety', () => {
  it('renders without throwing when value is null', () => {
    expect(() =>
      render(<VarInput value={null} onChange={() => {}} aria-label="v" />),
    ).not.toThrow();
    expect((screen.getByLabelText('v') as HTMLInputElement).value).toBe('');
  });

  it('renders without throwing when value is undefined', () => {
    expect(() =>
      render(<VarInput value={undefined} onChange={() => {}} aria-label="v2" />),
    ).not.toThrow();
    expect((screen.getByLabelText('v2') as HTMLInputElement).value).toBe('');
  });

  it('still shows a normal value and detects its {{tokens}}', () => {
    render(<VarInput value="{{baseUrl}}/pay" onChange={() => {}} aria-label="v3" />);
    expect((screen.getByLabelText('v3') as HTMLInputElement).value).toBe('{{baseUrl}}/pay');
  });
});
