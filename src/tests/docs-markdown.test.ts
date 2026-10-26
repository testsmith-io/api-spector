// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../shared/markdown-to-html';
import { flowchartToSvg } from '../shared/flowchart-svg';
import { generateHtml, type DocsPayload } from '../main/ipc/docs-handler';
import { makeCollection } from './fixtures/collection';

describe('markdownToHtml', () => {
  it('renders headings, lists, inline formatting and code', () => {
    const html = markdownToHtml('# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```json\n{"a":1}\n```');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<pre><code class="lang-json">');
  });

  it('renders a pipe table', () => {
    const html = markdownToHtml('| Key | Value |\n| --- | --- |\n| a | 1 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Key</th>');
    expect(html).toContain('<td>a</td>');
  });

  it('escapes HTML in text', () => {
    expect(markdownToHtml('a <script> b')).toContain('&lt;script&gt;');
  });

  it('renders only http/mailto links, leaving others as text', () => {
    expect(markdownToHtml('[ok](https://x.com)')).toContain('<a href="https://x.com"');
    expect(markdownToHtml('[no](javascript:alert(1))')).not.toContain('<a ');
  });

  it('routes a flow fence to the flowchart hook', () => {
    const html = markdownToHtml('```flow\nflowchart TD\nA-->B\n```', { flowchart: () => '<svg id="x"></svg>' });
    expect(html).toContain('<div class="md-diagram"><svg id="x"></svg></div>');
  });

  it('falls back to a code block when no flowchart hook is given', () => {
    const html = markdownToHtml('```flow\nA-->B\n```');
    expect(html).toContain('<pre><code');
  });
});

describe('flowchartToSvg', () => {
  it('draws an svg with node labels, a diamond, and an arrow marker', () => {
    const svg = flowchartToSvg('flowchart TD\nA([Start]) --> B{OK?}\nB -->|yes| C[Done]');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Start');
    expect(svg).toContain('OK?');
    expect(svg).toContain('<polygon');          // the diamond
    expect(svg).toContain('marker id="fc-arrow"');
    expect(svg).toContain('yes');                // edge label
  });

  it('returns an empty string for an empty diagram', () => {
    expect(flowchartToSvg('flowchart TD')).toBe('');
  });
});

describe('generateHtml with a diagram description', () => {
  it('renders a flow block in a collection description as an inline svg', () => {
    const col = makeCollection();
    col.description = 'Overview of the flow.\n\n```flow\nflowchart TD\n  A([Start]) --> B[Do it]\n```';
    const payload: DocsPayload = { format: 'html', collections: [{ collection: col, requests: col.requests }] };

    const html = generateHtml(payload);
    expect(html).toContain('class="md"');
    expect(html).toContain('<svg');
    expect(html).toContain('Do it');
    // The fenced source must not leak through as text.
    expect(html).not.toContain('```flow');
  });
});
