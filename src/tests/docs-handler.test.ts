// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from 'vitest';
import { generateMarkdown, generateHtml, escMd, escHtml, type DocsPayload } from '../main/ipc/docs-handler';
import { makeCollection } from './fixtures/collection';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const col = makeCollection();

const payload: DocsPayload = {
  format: 'markdown',
  collections: [{ collection: col, requests: col.requests }],
};

// ─── escMd ────────────────────────────────────────────────────────────────────

describe('escMd', () => {
  it('escapes pipe characters', () => {
    expect(escMd('a|b')).toContain('\\|');
  });

  it('escapes backticks', () => {
    expect(escMd('`code`')).toContain('\\`');
  });

  it('escapes asterisks', () => {
    expect(escMd('**bold**')).toContain('\\*');
  });

  it('leaves plain text unchanged', () => {
    expect(escMd('hello world')).toBe('hello world');
  });
});

// ─── escHtml ──────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  it('escapes ampersands', () => {
    expect(escHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less-than', () => {
    expect(escHtml('<script>')).toContain('&lt;');
  });

  it('escapes greater-than', () => {
    expect(escHtml('a>b')).toContain('&gt;');
  });

  it('escapes double-quotes', () => {
    expect(escHtml('"value"')).toContain('&quot;');
  });

  it('leaves plain text unchanged', () => {
    expect(escHtml('hello')).toBe('hello');
  });
});

// ─── generateMarkdown ─────────────────────────────────────────────────────────

describe('generateMarkdown', () => {
  const md = generateMarkdown(payload);

  it('starts with an H1 title', () => {
    expect(md).toMatch(/^# API Documentation/);
  });

  it('includes the collection name as H2', () => {
    expect(md).toContain(`## ${col.name}`);
  });

  it('includes request names', () => {
    expect(md).toContain('Get Users');
    expect(md).toContain('Create User');
    expect(md).toContain('Delete User');
  });

  it('includes URLs', () => {
    expect(md).toContain('/users');
  });

  it('includes header table for requests with headers', () => {
    expect(md).toContain('Accept');
    expect(md).toContain('application/json');
  });

  it('includes query params table', () => {
    expect(md).toContain('page');
  });

  it('includes JSON body for POST request', () => {
    expect(md).toContain('```json');
  });

  it('includes auth type for bearer auth', () => {
    expect(md).toContain('bearer');
  });

  it('works with multiple collections', () => {
    const twoColPayload: DocsPayload = {
      format: 'markdown',
      collections: [
        { collection: col, requests: col.requests },
        { collection: { ...col, id: 'col-2', name: 'Second API' }, requests: col.requests },
      ],
    };
    const out = generateMarkdown(twoColPayload);
    expect(out).toContain('User API');
    expect(out).toContain('Second API');
  });

  it('works with empty collections array', () => {
    const out = generateMarkdown({ format: 'markdown', collections: [] });
    expect(out).toContain('# API Documentation');
  });
});

// ─── generateHtml ─────────────────────────────────────────────────────────────

describe('generateHtml', () => {
  const html = generateHtml(payload);

  it('returns a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the page title', () => {
    expect(html).toContain('<title>API Documentation</title>');
  });

  it('includes the collection name', () => {
    expect(html).toContain('User API');
  });

  it('includes request names', () => {
    expect(html).toContain('Get Users');
    expect(html).toContain('Create User');
  });

  it('escapes HTML special characters in content', () => {
    const colWithSpecial = {
      ...col,
      name: '<script>alert("xss")</script>',
    };
    const out = generateHtml({
      format: 'html',
      collections: [{ collection: colWithSpecial, requests: col.requests }],
    });
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });

  it('includes embedded CSS', () => {
    expect(html).toContain('<style>');
  });

  it('uses method-colored spans', () => {
    expect(html).toContain('class="method"');
  });

  it('includes JSON body for POST request', () => {
    expect(html).toContain('lang-json');
  });
});
