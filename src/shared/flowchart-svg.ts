// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT
//
// Renders a flowchart code block to a self-contained <svg> string. Used by the
// documentation export (main process), where the React/@xyflow renderer can't
// run. Parsing + layout are shared with the in-app preview.

import { flowchartFromMarkdown, type FlowShape, type PositionedNode } from './flowchart-markdown';

const NODE_FILL = '#1e2433';
const NODE_STROKE = '#2d3748';
const NODE_TEXT = '#e2e8f0';
const EDGE = '#64748b';
const EDGE_TEXT = '#94a3b8';
const LABEL_BG = '#0f1117';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/** Point on a node's bounding box (half-size hw×hh, centred at `c`) in the
 *  direction of `toward` — so edges meet the border, not the centre. */
function borderPoint(c: [number, number], toward: [number, number], hw: number, hh: number): [number, number] {
  const dx = toward[0] - c[0];
  const dy = toward[1] - c[1];
  if (dx === 0 && dy === 0) return c;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return [c[0] + dx * scale, c[1] + dy * scale];
}

/** Greedy word-wrap into at most `maxLines` lines of ~`max` characters. */
function wrapLabel(label: string, max = 22, maxLines = 3): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, max - 1).trimEnd() + '…';
    return kept;
  }
  return lines.length ? lines : [''];
}

function shapeSvg(shape: FlowShape, x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const base = `fill="${NODE_FILL}" stroke="${NODE_STROKE}" stroke-width="1.5"`;
  switch (shape) {
    case 'round':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" ${base}/>`;
    case 'stadium':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${base}/>`;
    case 'circle':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${base}/>`;
    case 'diamond':
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${base}/>`;
    case 'hexagon':
      return `<polygon points="${x + w * 0.25},${y} ${x + w * 0.75},${y} ${x + w},${cy} ${x + w * 0.75},${y + h} ${x + w * 0.25},${y + h} ${x},${cy}" ${base}/>`;
    case 'subroutine':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ${base}/>`
        + `<line x1="${x + 7}" y1="${y}" x2="${x + 7}" y2="${y + h}" stroke="${NODE_STROKE}" stroke-width="1.5"/>`
        + `<line x1="${x + w - 7}" y1="${y}" x2="${x + w - 7}" y2="${y + h}" stroke="${NODE_STROKE}" stroke-width="1.5"/>`;
    case 'rect':
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" ${base}/>`;
  }
}

function labelSvg(label: string, cx: number, cy: number): string {
  const lines = wrapLabel(label);
  const lh = 14;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((ln, i) => `<tspan x="${cx.toFixed(1)}" dy="${i === 0 ? 0 : lh}">${esc(ln)}</tspan>`)
    .join('');
  return `<text x="${cx.toFixed(1)}" y="${startY.toFixed(1)}" fill="${NODE_TEXT}" font-size="12" `
    + `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" `
    + `text-anchor="middle" dominant-baseline="middle">${tspans}</text>`;
}

/** Render a flowchart code block to an <svg> string (empty string if nothing to draw). */
export function flowchartToSvg(code: string): string {
  const g = flowchartFromMarkdown(code);
  if (!g.nodes.length) return '';

  const W = g.nodeWidth;
  const H = g.nodeHeight;
  const pad = 24;
  const byId = new Map<string, PositionedNode>(g.nodes.map(n => [n.id, n]));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of g.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + W); maxY = Math.max(maxY, n.y + H);
  }
  const ox = -minX + pad;
  const oy = -minY + pad;
  const width = (maxX - minX) + pad * 2;
  const height = (maxY - minY) + pad * 2;
  const centre = (n: PositionedNode): [number, number] => [n.x + ox + W / 2, n.y + oy + H / 2];

  let edges = '';
  for (const e of g.edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (!s || !t || s === t) continue;
    const sc = centre(s);
    const tc = centre(t);
    const sp = borderPoint(sc, tc, W / 2, H / 2);
    const tp = borderPoint(tc, sc, W / 2, H / 2);
    const dash = e.style === 'dotted' ? ' stroke-dasharray="5 4"' : '';
    const sw = e.style === 'thick' ? 2.4 : 1.4;
    const marker = e.style === 'open' ? '' : ' marker-end="url(#fc-arrow)"';
    edges += `<line x1="${sp[0].toFixed(1)}" y1="${sp[1].toFixed(1)}" x2="${tp[0].toFixed(1)}" y2="${tp[1].toFixed(1)}" stroke="${EDGE}" stroke-width="${sw}"${dash}${marker}/>`;
    if (e.label) {
      const mx = (sp[0] + tp[0]) / 2;
      const my = (sp[1] + tp[1]) / 2;
      const w = e.label.length * 6 + 10;
      edges += `<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${w}" height="16" rx="3" fill="${LABEL_BG}"/>`;
      edges += `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" fill="${EDGE_TEXT}" font-size="11" text-anchor="middle" dominant-baseline="middle">${esc(e.label)}</text>`;
    }
  }

  let nodes = '';
  for (const n of g.nodes) {
    const x = n.x + ox;
    const y = n.y + oy;
    nodes += shapeSvg(n.shape, x, y, W, H) + labelSvg(n.label, x + W / 2, y + H / 2);
  }

  const drawnWidth = Math.min(width, 900);
  return `<svg class="flowchart" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${drawnWidth.toFixed(0)}" role="img" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${EDGE}"/></marker></defs>`
    + edges + nodes + `</svg>`;
}
