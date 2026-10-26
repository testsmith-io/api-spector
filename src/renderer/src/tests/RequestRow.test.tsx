// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Component test for the collection-tree RequestRow + its grouped examples.
// Covers the UX contract: examples live in an expandable "Saved examples"
// group (not as ordinary tree nodes), carry a file-code icon and no HTTP
// method badge, the request shows a live example count whether or not the
// group is expanded, and clicking an example opens that specific example.
//
// Run with: npx vitest --project renderer

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// --- Mocks: keep the row hermetic (no real store / i18n / cloud / modals). ---

vi.mock('../components/CollectionTree/CollectionTree', async () => {
  const { createContext } = await vi.importActual<typeof import('react')>('react');
  return {
    DragCtx: createContext({ dragging: null, setDragging: () => {}, onDropRequest: () => {}, onDropFolder: () => {}, onReorderChild: () => {} }),
    SelectionCtx: createContext({ active: false, isSelected: () => false, toggle: () => {}, clear: () => {} }),
    TagChips: () => null,
  };
});

vi.mock('../components/CollectionTree/SchemaSyncModal', () => ({ SchemaSyncModal: () => null }));

vi.mock('../store', () => {
  const state = { addSecurityTests: () => 0, collections: {} as Record<string, unknown> };
  const useStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useStore };
});

vi.mock('../i18n', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) => {
    const pick = key.includes('|') ? (Number(vars?.count) === 1 ? key.split('|')[0] : key.split('|')[1]) : key;
    return pick.replace(/:(\w+)/g, (_m, k) => String(vars?.[k] ?? ''));
  },
}));

vi.mock('../components/common/Toast', () => ({
  useToast: () => ({ toast: null, show: () => {} }),
  Toast: () => null,
}));

vi.mock('../lib/cloud-push', () => ({
  cloudEnabled: () => false,
  pushRequestAsMonitor: vi.fn(),
}));

import { RequestRow, type RequestRowProps } from '../components/CollectionTree/RequestRow';

function props(overrides: Partial<RequestRowProps> = {}): RequestRowProps {
  return {
    reqId: 'r1',
    collectionId: 'c1',
    folderId: 'f1',
    name: 'login',
    url: '{{baseUrl}}/users/login',
    method: 'POST',
    authType: 'none',
    tags: [],
    isActive: false,
    indent: 10,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onUpdateTags: vi.fn(),
    onSetHookType: vi.fn(),
    onToggleDisabled: vi.fn(),
    ...overrides,
  };
}

/** The example group is collapsed by default — click the request chevron. */
function expandExamples() {
  fireEvent.click(screen.getByTitle(/Show \d+ example/));
}

describe('RequestRow examples', () => {
  it('keeps examples collapsed by default, showing only the count', () => {
    render(<RequestRow {...props({
      examples: [{ id: 'e1', name: 'Successful login' }, { id: 'e2', name: 'Invalid credentials' }],
    })} />);

    // Count is visible without expanding...
    expect(screen.getByTitle('2 examples')).toHaveTextContent('2');
    // ...but the example rows are not rendered yet.
    expect(screen.queryByText('Successful login')).toBeNull();
  });

  it('expands into a plain example list (no header, no card) with no "EX" badge', () => {
    render(<RequestRow {...props({
      examples: [{ id: 'e1', name: 'Successful login' }, { id: 'e2', name: 'Invalid credentials' }],
    })} />);
    expandExamples();

    expect(screen.getByText('Successful login')).toBeInTheDocument();
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    // No "EXAMPLES"/"Saved examples" header, and no legacy "EX" badge.
    expect(screen.queryByText('Examples')).toBeNull();
    expect(screen.queryByText('Saved examples')).toBeNull();
    expect(screen.queryByText('EX')).toBeNull();
  });

  it('shows no HTTP method badge on example rows (method appears once, for the request)', () => {
    render(<RequestRow {...props({
      method: 'POST',
      examples: [{ id: 'e1', name: 'ok' }, { id: 'e2', name: 'bad' }],
    })} />);
    expandExamples();
    expect(screen.getAllByText('POST')).toHaveLength(1);
  });

  it('shows an example count that reflects the number of examples (even while collapsed)', () => {
    const { rerender } = render(<RequestRow {...props({
      examples: [{ id: 'e1', name: 'a' }, { id: 'e2', name: 'b' }],
    })} />);
    expect(screen.getByTitle('2 examples')).toHaveTextContent('2');

    // Count is derived from props, so it updates immediately when examples change.
    rerender(<RequestRow {...props({
      examples: [{ id: 'e1', name: 'a' }, { id: 'e2', name: 'b' }, { id: 'e3', name: 'c' }],
    })} />);
    expect(screen.getByTitle('3 examples')).toHaveTextContent('3');
  });

  it('shows no count and no chevron when the request has no examples', () => {
    render(<RequestRow {...props({ examples: [] })} />);
    expect(screen.queryByTitle(/example/)).toBeNull();
  });

  it('opens the clicked example (not the request editor)', () => {
    const onOpenExample = vi.fn();
    const onSelect = vi.fn();
    render(<RequestRow {...props({
      onSelect,
      onOpenExample,
      examples: [{ id: 'e1', name: 'Successful login' }],
    })} />);
    expandExamples();

    fireEvent.click(screen.getByText('Successful login'));
    expect(onOpenExample).toHaveBeenCalledWith('e1');
    expect(onSelect).not.toHaveBeenCalled();
    cleanup();
  });
});
