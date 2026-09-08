// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useEffect, useMemo, useState } from 'react';
import {
  findPrimaryArray, getByPath, joinPath, tableColumns, sortedIndices, classify, cellPreview,
} from '../../../../shared/response-table';

const MAX_ROWS = 1000;

// Convert an XML document into a plain JS structure so the same table logic
// works: repeated sibling elements become arrays, attributes are prefixed "@".
function xmlToJson(node: Element): unknown {
  const out: Record<string, unknown> = {};
  for (const attr of Array.from(node.attributes)) out[`@${attr.name}`] = attr.value;

  const childEls = Array.from(node.children);
  if (childEls.length === 0) {
    const text = node.textContent?.trim() ?? '';
    return node.attributes.length ? { ...out, '#text': text } : text;
  }
  for (const child of childEls) {
    const val = xmlToJson(child);
    if (child.tagName in out) {
      const existing = out[child.tagName];
      if (Array.isArray(existing)) existing.push(val);
      else out[child.tagName] = [existing, val];
    } else {
      out[child.tagName] = val;
    }
  }
  return out;
}

function parseBody(body: string, contentType: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const isXml = !contentType.includes('json') && (contentType.includes('xml') || body.trim().startsWith('<'));
  try {
    if (isXml) {
      const doc = new DOMParser().parseFromString(body, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Malformed XML');
      return { ok: true, value: doc.documentElement ? xmlToJson(doc.documentElement) : {} };
    }
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether a response body has any array worth tabulating (drives the toggle). */
export function bodyHasArray(body: string, contentType: string): boolean {
  const parsed = parseBody(body, contentType);
  return parsed.ok && findPrimaryArray(parsed.value) !== null;
}

interface Props { body: string; contentType: string }

export function ResponseTable({ body, contentType }: Props) {
  const parsed = useMemo(() => parseBody(body, contentType), [body, contentType]);
  const detected = useMemo(() => (parsed.ok ? findPrimaryArray(parsed.value) : null), [parsed]);

  const [path, setPath] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);

  // Reset to the auto-detected array whenever the response changes.
  useEffect(() => { setPath(detected?.path ?? ''); setSort(null); }, [detected]);

  if (!parsed.ok) return <div className="p-4 text-xs text-red-400">Could not parse body: {parsed.error}</div>;

  const target = getByPath(parsed.value, path);
  const rows = Array.isArray(target) ? target : null;

  const columns = rows ? tableColumns(rows) : [];
  const isPrimitiveRows = rows !== null && columns.length === 0;
  const sortCol = sort?.col ?? null;

  // Display order (plain computation, must stay below the early return above).
  const order = !rows
    ? []
    : (sort ? sortedIndices(rows, sort.col, sort.dir) : rows.map((_, i) => i)).slice(0, MAX_ROWS);

  function toggleSort(col: string) {
    setSort(s => s?.col === col ? (s.dir === 'asc' ? { col, dir: 'desc' } : null) : { col, dir: 'asc' });
  }

  // Drill into a nested array/object cell (uses the ORIGINAL row index so the
  // path stays correct even when the view is sorted).
  // Any navigation (drill in, breadcrumb, edit) resets the sort, since the
  // target - and thus its columns - changes.
  function navigate(p: string) { setPath(p); setSort(null); }

  function drill(originalIndex: number, col: string | null, value: unknown) {
    if (classify(value) === 'array' || classify(value) === 'object') {
      navigate(joinPath(path, originalIndex, col ?? undefined));
    }
  }

  // Drill into a field of an object (not an array element).
  function drillKey(key: string, value: unknown) {
    if (classify(value) === 'array' || classify(value) === 'object') {
      navigate(path ? `${path}.${key}` : key);
    }
  }

  // Path split into crumbs, each with the path that jumps to that level.
  const crumbs = (path.match(/[^.[\]]+|\[\d+\]/g) ?? []).reduce<{ label: string; path: string }[]>((acc, tok) => {
    const prev = acc.length ? acc[acc.length - 1].path : '';
    const next = tok.startsWith('[') ? prev + tok : (prev ? `${prev}.${tok}` : tok);
    acc.push({ label: tok, path: next });
    return acc;
  }, []);
  const parentPath = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : '';

  const th = 'px-3 py-1.5 text-left font-medium text-surface-300 border-b border-surface-800 cursor-pointer select-none whitespace-nowrap hover:text-white';
  const td = 'px-3 py-1 border-b border-surface-800/50 align-top';
  const arrow = (col: string) => sortCol === col ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Breadcrumb: click any level to jump back; up-one-level button */}
      <div className="border-b border-surface-800 flex-shrink-0">
        {path && (
          <div className="flex items-center gap-1 px-3 pt-2 text-xs flex-wrap">
            <button onClick={() => navigate(parentPath)} title="Up one level" className="px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 mr-1">↑ up</button>
            <button onClick={() => navigate('')} className="text-surface-400 hover:text-white">root</button>
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                <span className="text-surface-600">›</span>
                <button onClick={() => navigate(c.path)} className={`font-mono hover:text-white ${i === crumbs.length - 1 ? 'text-white font-semibold' : 'text-surface-400'}`}>{c.label}</button>
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <span className="text-surface-500">Path</span>
          <input
            value={path}
            onChange={e => navigate(e.target.value)}
            placeholder="(root) e.g. data.items"
            className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 font-mono text-[11px] focus:outline-none focus:border-blue-500"
          />
          <span className="text-surface-500 shrink-0">
            {rows ? `${rows.length} rows${columns.length ? ` · ${columns.length} cols` : ''}`
              : classify(target) === 'object' ? `${Object.keys(target as object).length} fields`
              : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {rows ? (
          <table className="text-[11px] font-mono w-full border-collapse">
            <thead className="sticky top-0 bg-surface-900">
              <tr>
                <th className="px-3 py-1.5 text-right text-surface-600 border-b border-surface-800 w-10">#</th>
                {isPrimitiveRows ? (
                  <th className={th} onClick={() => toggleSort('$value')}>value{arrow('$value')}</th>
                ) : (
                  columns.map(col => <th key={col} className={th} onClick={() => toggleSort(col)}>{col}{arrow(col)}</th>)
                )}
              </tr>
            </thead>
            <tbody>
              {order.map(i => {
                const row = rows[i];
                return (
                  <tr key={i} className="hover:bg-surface-800/40">
                    <td className="px-3 py-1 text-right text-surface-600 border-b border-surface-800/50">{i + 1}</td>
                    {isPrimitiveRows ? (
                      <td className={td}><Cell value={row} onDrill={() => drill(i, null, row)} /></td>
                    ) : (
                      columns.map(col => {
                        const v = row && typeof row === 'object' ? (row as Record<string, unknown>)[col] : undefined;
                        return <td key={col} className={td}><Cell value={v} onDrill={() => drill(i, col, v)} /></td>;
                      })
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : classify(target) === 'object' ? (
          // The path points at an object, not an array: show it as fields.
          <table className="text-[11px] font-mono w-full border-collapse">
            <tbody>
              {Object.entries(target as Record<string, unknown>).map(([k, v]) => (
                <tr key={k} className="hover:bg-surface-800/40">
                  <td className="px-3 py-1 text-surface-400 border-b border-surface-800/50 align-top whitespace-nowrap">{k}</td>
                  <td className={td}><Cell value={v} onDrill={() => drillKey(k, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : target !== undefined ? (
          // A primitive (or null): just show the value.
          <div className="p-4 text-xs font-mono text-surface-300 whitespace-pre-wrap break-all">{String(target)}</div>
        ) : (
          <div className="p-4 text-xs text-surface-500">
            Nothing at <span className="font-mono text-surface-400">{path || '(root)'}</span>.
            {detected ? <> Detected array: <button className="font-mono text-blue-400" onClick={() => navigate(detected.path)}>{detected.path || '(root)'}</button></> : ''}
          </div>
        )}
        {rows && rows.length > MAX_ROWS && (
          <div className="p-2 text-[10px] text-surface-500">Showing first {MAX_ROWS} of {rows.length} rows.</div>
        )}
      </div>
    </div>
  );
}

function Cell({ value, onDrill }: { value: unknown; onDrill: () => void }) {
  const kind = classify(value);
  if (kind === 'array' || kind === 'object') {
    return (
      <button onClick={onDrill} title="Open this nested value" className="text-blue-400 hover:underline">
        {kind === 'array' ? cellPreview(value) : '{…}'}
      </button>
    );
  }
  if (kind === 'null') return <span className="text-surface-600">null</span>;
  // Keep cells to a single line and truncate long values (ids, tokens) with an
  // ellipsis so a long id can't blow up the row height; full value on hover.
  const text = String(value);
  return (
    <span className="inline-block max-w-[26rem] truncate align-bottom text-surface-300" title={text.length > 40 ? text : undefined}>
      {text}
    </span>
  );
}
