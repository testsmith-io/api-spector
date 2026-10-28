// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The documentation PREVIEW renderer must render GFM pipe tables (it previously
// showed the raw `| … |` source), matching the exported HTML.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { renderMarkdown } from '../lib/markdown';

afterEach(cleanup);

describe('renderMarkdown — tables', () => {
  const TABLE = [
    '| First name | Role  | E-mail                 |',
    '|------------|-------|------------------------|',
    '| John       | admin | admin@example.com      |',
    '| Jane       | user  | customer@example.com   |',
  ].join('\n');

  it('renders a pipe table as a real <table>, not raw text', () => {
    render(<div>{renderMarkdown(TABLE)}</div>);
    expect(document.querySelector('table')).toBeTruthy();
    expect(document.querySelectorAll('thead th')).toHaveLength(3);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('First name')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    // The raw pipe source must not leak through as a paragraph.
    expect(document.body.textContent).not.toContain('|------------|');
  });

  it('leaves a lone pipe line (no separator row) as a paragraph, not a table', () => {
    render(<div>{renderMarkdown('a | b | c')}</div>);
    expect(document.querySelector('table')).toBeNull();
  });
});
