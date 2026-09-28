// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

// A compact, dependency-free Markdown renderer for documentation preview.
// It escapes all text (React does this for us by rendering strings as children)
// and never injects raw HTML, so untrusted doc content cannot inject markup.
// Supports: headings, bold/italic/inline-code, links, fenced + inline code,
// unordered/ordered lists, blockquotes, horizontal rules, and paragraphs.

// ── Inline ──────────────────────────────────────────────────────────────────

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key} className="font-mono text-[0.85em] bg-surface-800 rounded px-1 py-0.5">{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      // Only allow http(s) and mailto; anything else renders as plain text.
      const href = link[2];
      if (/^(https?:|mailto:)/i.test(href)) {
        return <a key={key} href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{link[1]}</a>;
      }
      return <React.Fragment key={key}>{link[1]}</React.Fragment>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replaceAll('\r\n', '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `md-${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++; // consume closing fence
      blocks.push(
        <pre key={k()} className="bg-surface-800 border border-surface-700 rounded p-2.5 overflow-x-auto text-[11px] font-mono leading-relaxed">
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={k()} className="border-surface-700 my-3" />); i++; continue; }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls = ['text-lg font-semibold mt-1', 'text-base font-semibold mt-1', 'text-sm font-semibold', 'text-sm font-medium', 'text-xs font-semibold', 'text-xs font-medium'][level - 1];
      const content = renderInline(heading[2], k());
      const props = { key: k(), className: `${cls} text-surface-100` };
      blocks.push(React.createElement(`h${level}`, props, content));
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(
        <blockquote key={k()} className="border-l-2 border-surface-600 pl-3 text-surface-400 italic">
          {renderInline(buf.join(' '), k())}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(<li key={k()}>{renderInline(lines[i].replace(/^\s*[-*+]\s+/, ''), k())}</li>);
        i++;
      }
      blocks.push(<ul key={k()} className="list-disc pl-5 flex flex-col gap-0.5">{items}</ul>);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={k()}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''), k())}</li>);
        i++;
      }
      blocks.push(<ol key={k()} className="list-decimal pl-5 flex flex-col gap-0.5">{items}</ol>);
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-block lines
    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== ''
      && !lines[i].trim().startsWith("```")
      && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    blocks.push(<p key={k()} className="leading-relaxed">{renderInline(buf.join('\n'), k())}</p>);
  }

  return <div className="flex flex-col gap-2 text-xs text-surface-300">{blocks}</div>;
}
