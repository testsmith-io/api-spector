// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// dayjs() objects are chainable, so a member access after a dayjs(...) call
// should complete its instance methods (format, add, toISOString, ...).
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { makeAtCompletionSource, callNameBeforeCursor } from '../renderer/src/components/RequestBuilder/atCompletions';

function completeAtEnd(text: string): string[] {
  const state = EditorState.create({ doc: text });
  const ctx = new CompletionContext(state, text.length, false);
  const res = makeAtCompletionSource([])(ctx);
  return res ? res.options.map(o => o.label) : [];
}

describe('dayjs completion', () => {
  it('offers instance methods right after dayjs().', () => {
    const labels = completeAtEnd("sp.environment.set('t', dayjs().");
    expect(labels).toContain('format');
    expect(labels).toContain('toISOString');
    expect(labels).toContain('add');
  });

  it('offers methods on a chained dayjs() call', () => {
    const labels = completeAtEnd('const x = dayjs().add(1, "day").');
    expect(labels).toContain('format');
  });

  it('does not offer dayjs methods on an unrelated paren chain', () => {
    const labels = completeAtEnd('foo().');
    expect(labels).not.toContain('toISOString');
  });
});

describe('dayjs unit-argument completion', () => {
  it('offers units inside startOf(', () => {
    const labels = completeAtEnd("const d = dayjs().startOf('");
    expect(labels).toContain('day');
    expect(labels).toContain('month');
  });

  it('offers units for the second arg of add(', () => {
    const labels = completeAtEnd("dayjs().add(1, 'da");
    expect(labels).toEqual(['day', 'date']);
  });

  it('does not offer units for a non-dayjs add(', () => {
    const labels = completeAtEnd("list.add(1, 'da");
    expect(labels).not.toContain('day');
  });
});

// callNameBeforeCursor drives the parameter-hint tooltip (signatureHelpExtension).
describe('callNameBeforeCursor', () => {
  it('finds the innermost unclosed call the cursor is in', () => {
    expect(callNameBeforeCursor('dayjs().add(')).toBe('add');
    expect(callNameBeforeCursor('dayjs().add(1, ')).toBe('add');
    expect(callNameBeforeCursor("dayjs().startOf(")).toBe('startOf');
    expect(callNameBeforeCursor('foo(bar(), ')).toBe('foo');
    expect(callNameBeforeCursor('noCallHere')).toBeNull();
  });
});
