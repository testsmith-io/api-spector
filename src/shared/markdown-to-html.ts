// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// A compact Markdown -> HTML string renderer for the documentation export (main
// process, where the React preview renderer can't run). All text is escaped, so
// it is safe for untrusted description content. A `flow` / `flowchart` fenced
// block is handed to the optional `flowchart` hook (which draws an <svg>).

import { escapeHtml } from './escape';

export interface MarkdownToHtmlOptions {
  /** Render a flowchart code block to an <svg> string. */
  flowchart?: (code: string) => string;
}

/** Inline formatting on already-escaped text: code, bold, italic, links. */
function inlineFmt(escaped: string): string {
  return escaped
    .split(/(`[^`]+`)/g)
    .map(part => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return part
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text: string, href: string) =>
          /^(https?:|mailto:)/i.test(href)
            ? `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`
            : m);
    })
    .join('');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

export function markdownToHtml(md: string, opts: MarkdownToHtmlOptions = {}): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (flowchart blocks render as a diagram)
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim().toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++; // closing fence
      const code = buf.join('\n');
      if ((lang === 'flow' || lang === 'flowchart') && opts.flowchart) {
        const svg = opts.flowchart(code);
        out.push(svg ? `<div class="md-diagram">${svg}</div>` : `<pre><code>${escapeHtml(code)}</code></pre>`);
      } else {
        out.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${inlineFmt(escapeHtml(heading[2]))}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${inlineFmt(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // GitHub-style pipe table: header row followed by a |---|---| separator.
    if (line.includes('|') && i + 1 < lines.length
      && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(splitRow(lines[i])); i++; }
      let t = '<table><thead><tr>' + header.map(c => `<th>${inlineFmt(escapeHtml(c))}</th>`).join('') + '</tr></thead><tbody>';
      for (const r of rows) t += '<tr>' + r.map(c => `<td>${inlineFmt(escapeHtml(c))}</td>`).join('') + '</tr>';
      t += '</tbody></table>';
      out.push(t);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inlineFmt(escapeHtml(lines[i].replace(/^\s*[-*+]\s+/, '')))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineFmt(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, '')))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph
    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== ''
      && !lines[i].trim().startsWith('```')
      && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${inlineFmt(escapeHtml(buf.join('\n')).replace(/\n/g, '<br/>'))}</p>`);
  }

  return out.join('\n');
}
