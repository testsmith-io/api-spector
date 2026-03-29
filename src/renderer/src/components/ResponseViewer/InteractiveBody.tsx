// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonPath = (string | number)[]

type PopoverState =
  | { type: 'json'; path: JsonPath; value: unknown; root: unknown; x: number; y: number }
  | { type: 'xml';  selector: string; value: string; x: number; y: number }

// ─── Snippet helpers ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function jsonAccessor(path: JsonPath): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${acc}.${key}` : `${acc}["${esc(key)}"]`;
  }, 'json');
}

function jsonPathLabel(path: JsonPath): string {
  if (path.length === 0) return '$';
  return path.map(k => (typeof k === 'number' ? `[${k}]` : k)).join('.');
}

function toLit(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${esc(v)}"`;
  return String(v);
}

function makeJsonSnippet(
  path: JsonPath,
  value: unknown,
  mode: 'equals' | 'exists' | 'type' | 'contains',
): string {
  const acc = jsonAccessor(path);
  const label = jsonPathLabel(path);
  const lit = toLit(value);
  const decl = 'const json = sp.response.json();';

  switch (mode) {
    case 'equals':
      return `sp.test('${label} equals ${lit}', function() {\n  ${decl}\n  sp.expect(${acc}).to.equal(${lit});\n});`;
    case 'exists':
      return `sp.test('${label} exists', function() {\n  ${decl}\n  sp.expect(${acc}).to.not.be.oneOf([null, undefined]);\n});`;
    case 'type': {
      const t = value === null ? 'null' : typeof value;
      return `sp.test('${label} is ${t}', function() {\n  ${decl}\n  sp.expect(${acc}).to.be.a("${t}");\n});`;
    }
    case 'contains':
      return `sp.test('${label} contains ${lit}', function() {\n  ${decl}\n  sp.expect(${acc}).to.include(${lit});\n});`;
  }
}

function getAtPath(root: unknown, path: JsonPath): unknown {
  let cur = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function toJsonPathExpr(path: JsonPath, filterKey: string, filterValue: string): string {
  // Find last numeric index in path — that's the array boundary
  let arrayIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === 'number') { arrayIdx = i; break; }
  }
  if (arrayIdx < 0) return '';

  const arrayPart = '$.' + path.slice(0, arrayIdx).join('.');        // e.g. $.data
  const leafPart  = path.slice(arrayIdx + 1).join('.');               // e.g. price
  const filterVal = isNaN(Number(filterValue))
    ? `"${filterValue.replace(/"/g, '\\"')}"`
    : filterValue;

  const expr = leafPart
    ? `${arrayPart}[?(@.${filterKey}==${filterVal})].${leafPart}`
    : `${arrayPart}[?(@.${filterKey}==${filterVal})]`;

  return expr;
}

function makeJsonPathSnippet(path: JsonPath, value: unknown, filterKey: string, filterValue: string): string {
  const expr = toJsonPathExpr(path, filterKey, filterValue);
  const lit  = toLit(value);
  return `sp.test('${expr} equals ${lit}', function() {\n  const matches = sp.jsonPath(sp.response.json(), '${expr}');\n  sp.expect(matches.length).to.be.above(0);\n  sp.expect(matches[0]).to.equal(${lit});\n});`;
}

function makeXmlSnippet(
  selector: string,
  value: string,
  mode: 'equals' | 'exists' | 'contains',
): string {
  const sel = selector.replace(/"/g, '\\"');
  switch (mode) {
    case 'equals':
      return `sp.test('${selector} equals "${esc(value)}"', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.equal("${esc(value)}");\n});`;
    case 'exists':
      return `sp.test('${selector} exists', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.not.equal(null);\n});`;
    case 'contains':
      return `sp.test('${selector} contains "${esc(value)}"', function() {\n  sp.expect(sp.response.xmlText("${sel}")).to.include("${esc(value)}");\n});`;
  }
}

function varNameFromPath(path: JsonPath): string {
  return path.filter(k => typeof k === 'string').at(-1) as string ?? 'extracted_value';
}

function makeJsonExtractSnippet(path: JsonPath, target: 'variables' | 'environment'): string {
  const acc     = jsonAccessor(path);
  const varName = varNameFromPath(path);
  return `const json = sp.response.json();\nsp.${target}.set("${varName}", String(${acc}));`;
}

function makeJsonPathExtractSnippet(path: JsonPath, filterKey: string, filterValue: string, target: 'variables' | 'environment'): string {
  const expr    = toJsonPathExpr(path, filterKey, filterValue);
  const varName = varNameFromPath(path);
  return `const matches = sp.jsonPath(sp.response.json(), '${expr}');\nsp.${target}.set("${varName}", String(matches[0] ?? ''));`;
}

function makeXmlExtractSnippet(selector: string, target: 'variables' | 'environment'): string {
  return `sp.${target}.set("extracted_value", sp.response.xmlText("${selector.replace(/"/g, '\\"')}") ?? '');`;
}

// ─── Assertion popover ────────────────────────────────────────────────────────

function AssertMenu({
  state,
  onClose,
  onConfirm,
}: {
  state: PopoverState
  onClose: () => void
  onConfirm: (snippet: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [jpOpen, setJpOpen] = useState(false);
  const [filterKey, setFilterKey] = useState('');
  const [filterVal, setFilterVal] = useState('');

  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  let title = '';
  let options: { label: string; snippet: string }[] = [];
  let jpSiblingKeys: string[] = [];
  let jpAvailable = false;

  if (state.type === 'json') {
    const { path, value, root } = state;
    const isStr = typeof value === 'string';
    const preview = isStr
      ? `"${(value as string).length > 22 ? (value as string).slice(0, 22) + '…' : value}"`
      : String(value);
    title = jsonPathLabel(path);
    options = [
      { label: `equals ${preview}`,               snippet: makeJsonSnippet(path, value, 'equals')   },
      { label: 'exists (not null/undefined)',      snippet: makeJsonSnippet(path, value, 'exists')   },
      { label: `is ${value === null ? 'null' : typeof value}`, snippet: makeJsonSnippet(path, value, 'type') },
      ...(isStr ? [{ label: `contains ${preview}`, snippet: makeJsonSnippet(path, value, 'contains') }] : []),
    ];

    // JSONPath filter: only when value is inside an array
    const arrayIdx = [...path].reverse().findIndex(k => typeof k === 'number');
    if (arrayIdx >= 0) {
      jpAvailable = true;
      const realIdx = path.length - 1 - arrayIdx;
      const itemObj = getAtPath(root, path.slice(0, realIdx + 1));
      if (itemObj != null && typeof itemObj === 'object' && !Array.isArray(itemObj)) {
        jpSiblingKeys = Object.keys(itemObj as Record<string, unknown>).filter(k => {
          const v = (itemObj as Record<string, unknown>)[k];
          return typeof v !== 'object' || v === null;
        });
      }
      if (!filterKey && jpSiblingKeys.length > 0) {
        // seed defaults once
        const defaultKey = jpSiblingKeys.find(k => k === 'name' || k === 'id') ?? jpSiblingKeys[0];
        setTimeout(() => {
          setFilterKey(defaultKey);
          const seed = getAtPath(root, [...path.slice(0, realIdx + 1), defaultKey]);
          setFilterVal(seed != null ? String(seed) : '');
        }, 0);
      }
    }
  } else {
    const { selector, value } = state;
    const preview = `"${value.length > 22 ? value.slice(0, 22) + '…' : value}"`;
    title = selector;
    options = [
      { label: `equals ${preview}`,  snippet: makeXmlSnippet(selector, value, 'equals')   },
      { label: 'exists',             snippet: makeXmlSnippet(selector, value, 'exists')   },
      { label: `contains ${preview}`,snippet: makeXmlSnippet(selector, value, 'contains') },
    ];
  }

  const x = Math.min(state.x, window.innerWidth  - 280);
  const y = Math.min(state.y, window.innerHeight - 280);

  return (
    <div
      ref={ref}
      style={{ top: y, left: x, position: 'fixed' }}
      className="z-[200] bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-2 min-w-[260px]"
    >
      <div className="text-[10px] text-surface-500 font-mono px-1.5 pb-1.5 mb-1.5 border-b border-surface-800 truncate">
        {title}
      </div>
      {options.map(opt => (
        <button
          key={opt.label}
          onClick={() => { onConfirm(opt.snippet); onClose(); }}
          className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
        >
          {opt.label}
        </button>
      ))}

      {jpAvailable && (
        <div className="mt-1 border-t border-surface-800 pt-1">
          <button
            onClick={() => setJpOpen(o => !o)}
            className="w-full text-left text-xs text-blue-400 hover:text-blue-300 hover:bg-surface-800 rounded px-2 py-1.5 transition-colors flex items-center gap-1"
          >
            <span>{jpOpen ? '▾' : '▸'}</span>
            <span>JSONPath assert (with filter)</span>
          </button>
          {jpOpen && state.type === 'json' && (
            <div className="mt-1 px-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-surface-400 w-16 shrink-0">filter by</span>
                <select
                  value={filterKey}
                  onChange={e => {
                    const k = e.target.value;
                    setFilterKey(k);
                    const arrayIdx2 = [...state.path].reverse().findIndex(seg => typeof seg === 'number');
                    const realIdx2 = state.path.length - 1 - arrayIdx2;
                    const itemObj2 = getAtPath(state.root, state.path.slice(0, realIdx2 + 1));
                    const seed = itemObj2 != null ? (itemObj2 as Record<string, unknown>)[k] : undefined;
                    setFilterVal(seed != null ? String(seed) : '');
                  }}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs focus:outline-none"
                >
                  {jpSiblingKeys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-surface-400 w-16 shrink-0">equals</span>
                <input
                  value={filterVal}
                  onChange={e => setFilterVal(e.target.value)}
                  className="flex-1 bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex gap-1 self-end">
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathSnippet(state.path, state.value, filterKey, filterVal)); onClose(); }}
                  className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded transition-colors"
                >
                  Assert
                </button>
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathExtractSnippet(state.path, filterKey, filterVal, 'variables')); onClose(); }}
                  className="text-xs px-2 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors"
                >
                  → variable
                </button>
                <button
                  disabled={!filterKey || !filterVal}
                  onClick={() => { onConfirm(makeJsonPathExtractSnippet(state.path, filterKey, filterVal, 'environment')); onClose(); }}
                  className="text-xs px-2 py-1 bg-surface-700 hover:bg-surface-600 disabled:opacity-40 rounded transition-colors"
                >
                  → env
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Extract section ── */}
      <div className="mt-1 border-t border-surface-800 pt-1">
        <div className="text-[10px] text-surface-500 uppercase tracking-wider px-2 py-1">Extract</div>
        {state.type === 'json' ? (
          <>
            <button
              onClick={() => { onConfirm(makeJsonExtractSnippet(state.path, 'variables')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to variable
            </button>
            <button
              onClick={() => { onConfirm(makeJsonExtractSnippet(state.path, 'environment')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to environment
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { onConfirm(makeXmlExtractSnippet((state as { selector: string }).selector, 'variables')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to variable
            </button>
            <button
              onClick={() => { onConfirm(makeXmlExtractSnippet((state as { selector: string }).selector, 'environment')); onClose(); }}
              className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
            >
              Save to environment
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── JSON tree ────────────────────────────────────────────────────────────────

function JsonNode({
  nodeKey,
  value,
  path,
  depth,
  onLeaf,
}: {
  nodeKey: string | number | null
  value: unknown
  path: JsonPath
  depth: number
  onLeaf: (e: React.MouseEvent, path: JsonPath, value: unknown) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const keySpan =
    nodeKey !== null ? (
      <span className="text-surface-500 font-mono text-xs shrink-0 select-all">
        {typeof nodeKey === 'number' ? `[${nodeKey}]` : nodeKey}
        {value === null || typeof value !== 'object' ? ':' : ''}
      </span>
    ) : null;

  /* ── leaf ── */
  if (value === null || typeof value !== 'object') {
    const display =
      value === null
        ? 'null'
        : typeof value === 'string'
          ? `"${(value as string).length > 100 ? (value as string).slice(0, 100) + '…' : value}"`
          : String(value);
    const cls =
      value === null
        ? 'text-surface-600 italic'
        : typeof value === 'string'
          ? 'text-emerald-400'
          : typeof value === 'number'
            ? 'text-blue-400'
            : 'text-amber-400'; // boolean

    return (
      <div className="group flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 min-w-0">
        {keySpan}
        <span className={`font-mono text-xs ${cls} select-all break-all min-w-0 truncate`}>{display}</span>
        <button
          onClick={e => onLeaf(e, path, value)}
          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-1.5 leading-4 py-0.5 text-blue-400 border border-blue-800 hover:border-blue-500 hover:text-blue-300 rounded transition-all"
          title="Add assertion for this value"
        >
          + insert
        </button>
      </div>
    );
  }

  /* ── branch ── */
  const isArr = Array.isArray(value);
  const entries: [string | number, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArr ? `[${(value as unknown[]).length}]` : `{${entries.length}}`;

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 w-full text-left"
      >
        <span className="text-surface-600 text-[10px] w-3 shrink-0 text-center">
          {expanded ? '▾' : '▸'}
        </span>
        {keySpan}
        <span className="text-surface-600 text-xs">{summary}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-surface-800 pl-1">
          {entries.map(([k, v]) => (
            <JsonNode
              key={String(k)}
              nodeKey={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              onLeaf={onLeaf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── XML tree ─────────────────────────────────────────────────────────────────

function buildSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const parent = cur.parentElement;
    if (!parent) break;
    const tag = cur.tagName;
    const siblings = Array.from(parent.children).filter(c => c.tagName === tag);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(' > ');
}

function XmlNode({
  element,
  depth,
  onLeaf,
}: {
  element: Element
  depth: number
  onLeaf: (e: React.MouseEvent, selector: string, value: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const childEls = Array.from(element.children);
  const tag = element.tagName;

  /* ── leaf element (no child elements, only text) ── */
  if (childEls.length === 0) {
    const text = element.textContent ?? '';
    const selector = buildSelector(element);
    return (
      <div className="group flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 min-w-0">
        <span className="text-blue-300 font-mono text-xs shrink-0">&lt;{tag}&gt;</span>
        <span className="text-emerald-400 font-mono text-xs select-all break-all min-w-0 truncate">
          {text.length > 100 ? text.slice(0, 100) + '…' : text}
        </span>
        <button
          onClick={e => onLeaf(e, selector, text)}
          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-1.5 leading-4 py-0.5 text-blue-400 border border-blue-800 hover:border-blue-500 hover:text-blue-300 rounded transition-all"
          title="Add assertion for this value"
        >
          + insert
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 w-full text-left"
      >
        <span className="text-surface-600 text-[10px] w-3 shrink-0 text-center">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="text-blue-300 font-mono text-xs">&lt;{tag}&gt;</span>
        <span className="text-surface-600 text-xs ml-1">{childEls.length}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-surface-800 pl-1">
          {childEls.map((child, i) => (
            <XmlNode key={i} element={child} depth={depth + 1} onLeaf={onLeaf} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  body: string
  contentType: string
  onAssert: (snippet: string) => void
}

export function InteractiveBody({ body, contentType, onAssert }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const isJson = contentType.includes('json');
  const isXml  = !isJson && (contentType.includes('xml') || contentType.includes('html'));

  let parsedJson: unknown = null;
  if (isJson) {
    try { parsedJson = JSON.parse(body); } catch { /* handled below */ }
  }

  function handleJsonLeaf(e: React.MouseEvent, path: JsonPath, value: unknown) {
    e.stopPropagation();
    setPopover({ type: 'json', path, value, root: parsedJson, x: e.clientX + 10, y: e.clientY + 10 });
  }

  function handleXmlLeaf(e: React.MouseEvent, selector: string, value: string) {
    e.stopPropagation();
    setPopover({ type: 'xml', selector, value, x: e.clientX + 10, y: e.clientY + 10 });
  }

  const treeContent = isJson ? (() => {
    if (parsedJson === null) {
      return <div className="p-4 text-xs text-surface-600">Unable to parse JSON response body</div>;
    }
    return <JsonNode nodeKey={null} value={parsedJson} path={[]} depth={0} onLeaf={handleJsonLeaf} />;
  })() : isXml ? (() => {
    const doc = new DOMParser().parseFromString(body, 'text/xml');
    const root = doc.documentElement;
    if (root.tagName === 'parsererror') {
      return <div className="p-4 text-xs text-surface-600">Unable to parse XML response body</div>;
    }
    return <XmlNode element={root} depth={0} onLeaf={handleXmlLeaf} />;
  })() : (
    <div className="p-4 text-xs text-surface-600">Interactive tree not available for this content type. Use Raw view.</div>
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 font-mono">
      {popover && (
        <AssertMenu
          state={popover}
          onClose={() => setPopover(null)}
          onConfirm={snippet => { onAssert(snippet); setPopover(null); }}
        />
      )}
      {treeContent}
    </div>
  );
}
