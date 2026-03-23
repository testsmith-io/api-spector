import React, { useState, useEffect, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonPath = (string | number)[]

type PopoverState =
  | { type: 'json'; path: JsonPath; value: unknown; x: number; y: number }
  | { type: 'xml';  selector: string; value: string; x: number; y: number }

// ─── Snippet helpers ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')
}

function jsonAccessor(path: JsonPath): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${acc}.${key}` : `${acc}["${esc(key)}"]`
  }, 'json')
}

function jsonPathLabel(path: JsonPath): string {
  if (path.length === 0) return '$'
  return path.map(k => (typeof k === 'number' ? `[${k}]` : k)).join('.')
}

function toLit(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${esc(v)}"`
  return String(v)
}

function makeJsonSnippet(
  path: JsonPath,
  value: unknown,
  mode: 'equals' | 'exists' | 'type' | 'contains',
): string {
  const acc = jsonAccessor(path)
  const label = jsonPathLabel(path)
  const lit = toLit(value)
  const decl = 'const json = sp.response.json();'

  switch (mode) {
    case 'equals':
      return `sp.test('${label} equals ${lit}', function() {\n  ${decl}\n  sp.expect(${acc}).to.equal(${lit});\n});`
    case 'exists':
      return `sp.test('${label} exists', function() {\n  ${decl}\n  sp.expect(${acc}).to.not.be.oneOf([null, undefined]);\n});`
    case 'type': {
      const t = value === null ? 'null' : typeof value
      return `sp.test('${label} is ${t}', function() {\n  ${decl}\n  sp.expect(${acc}).to.be.a("${t}");\n});`
    }
    case 'contains':
      return `sp.test('${label} contains ${lit}', function() {\n  ${decl}\n  sp.expect(${acc}).to.include(${lit});\n});`
  }
}

function makeXmlSnippet(
  selector: string,
  value: string,
  mode: 'equals' | 'exists' | 'contains',
): string {
  const parse = `const doc = new DOMParser().parseFromString(sp.response.text(), "text/xml");`
  const query = `const el = doc.querySelector("${selector.replace(/"/g, '\\"')}");`

  switch (mode) {
    case 'equals':
      return `sp.test('${selector} equals "${esc(value)}"', function() {\n  ${parse}\n  ${query}\n  sp.expect(el?.textContent?.trim()).to.equal("${esc(value)}");\n});`
    case 'exists':
      return `sp.test('${selector} exists', function() {\n  ${parse}\n  ${query}\n  sp.expect(el).to.not.equal(null);\n});`
    case 'contains':
      return `sp.test('${selector} contains "${esc(value)}"', function() {\n  ${parse}\n  ${query}\n  sp.expect(el?.textContent).to.include("${esc(value)}");\n});`
  }
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  let title = ''
  let options: { label: string; snippet: string }[] = []

  if (state.type === 'json') {
    const { path, value } = state
    const isStr = typeof value === 'string'
    const preview = isStr
      ? `"${(value as string).length > 22 ? (value as string).slice(0, 22) + '…' : value}"`
      : String(value)
    title = jsonPathLabel(path)
    options = [
      { label: `equals ${preview}`,               snippet: makeJsonSnippet(path, value, 'equals')   },
      { label: 'exists (not null/undefined)',      snippet: makeJsonSnippet(path, value, 'exists')   },
      { label: `is ${value === null ? 'null' : typeof value}`, snippet: makeJsonSnippet(path, value, 'type') },
      ...(isStr ? [{ label: `contains ${preview}`, snippet: makeJsonSnippet(path, value, 'contains') }] : []),
    ]
  } else {
    const { selector, value } = state
    const preview = `"${value.length > 22 ? value.slice(0, 22) + '…' : value}"`
    title = selector
    options = [
      { label: `equals ${preview}`,  snippet: makeXmlSnippet(selector, value, 'equals')   },
      { label: 'exists',             snippet: makeXmlSnippet(selector, value, 'exists')   },
      { label: `contains ${preview}`,snippet: makeXmlSnippet(selector, value, 'contains') },
    ]
  }

  const x = Math.min(state.x, window.innerWidth  - 260)
  const y = Math.min(state.y, window.innerHeight - 220)

  return (
    <div
      ref={ref}
      style={{ top: y, left: x, position: 'fixed' }}
      className="z-[200] bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-2 min-w-[240px]"
    >
      <div className="text-[10px] text-surface-500 font-mono px-1.5 pb-1.5 mb-1.5 border-b border-surface-800 truncate">
        {title}
      </div>
      {options.map(opt => (
        <button
          key={opt.label}
          onClick={() => { onConfirm(opt.snippet); onClose() }}
          className="w-full text-left text-xs text-surface-300 hover:text-white hover:bg-surface-800 rounded px-2 py-1.5 transition-colors"
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
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
  const [expanded, setExpanded] = useState(depth < 2)

  const keySpan =
    nodeKey !== null ? (
      <span className="text-surface-500 font-mono text-xs shrink-0 select-all">
        {typeof nodeKey === 'number' ? `[${nodeKey}]` : nodeKey}
        {value === null || typeof value !== 'object' ? ':' : ''}
      </span>
    ) : null

  /* ── leaf ── */
  if (value === null || typeof value !== 'object') {
    const display =
      value === null
        ? 'null'
        : typeof value === 'string'
          ? `"${(value as string).length > 100 ? (value as string).slice(0, 100) + '…' : value}"`
          : String(value)
    const cls =
      value === null
        ? 'text-surface-600 italic'
        : typeof value === 'string'
          ? 'text-emerald-400'
          : typeof value === 'number'
            ? 'text-blue-400'
            : 'text-amber-400' // boolean

    return (
      <div className="group flex items-center gap-1.5 py-0.5 pl-1 rounded hover:bg-surface-800/40 min-w-0">
        {keySpan}
        <span className={`font-mono text-xs ${cls} select-all break-all min-w-0 truncate`}>{display}</span>
        <button
          onClick={e => onLeaf(e, path, value)}
          className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-[10px] px-1.5 leading-4 py-0.5 text-blue-400 border border-blue-800 hover:border-blue-500 hover:text-blue-300 rounded transition-all"
          title="Add assertion for this value"
        >
          + assert
        </button>
      </div>
    )
  }

  /* ── branch ── */
  const isArr = Array.isArray(value)
  const entries: [string | number, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>)
  const summary = isArr ? `[${(value as unknown[]).length}]` : `{${entries.length}}`

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
  )
}

// ─── XML tree ─────────────────────────────────────────────────────────────────

function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur) {
    const parent = cur.parentElement
    if (!parent) break
    const tag = cur.tagName
    const siblings = Array.from(parent.children).filter(c => c.tagName === tag)
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag)
    cur = parent
  }
  return parts.join(' > ')
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
  const [expanded, setExpanded] = useState(depth < 3)
  const childEls = Array.from(element.children)
  const tag = element.tagName

  /* ── leaf element (no child elements, only text) ── */
  if (childEls.length === 0) {
    const text = element.textContent ?? ''
    const selector = buildSelector(element)
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
          + assert
        </button>
      </div>
    )
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
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface Props {
  body: string
  contentType: string
  onAssert: (snippet: string) => void
}

export function InteractiveBody({ body, contentType, onAssert }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const isJson = contentType.includes('json')
  const isXml  = !isJson && (contentType.includes('xml') || contentType.includes('html'))

  function handleJsonLeaf(e: React.MouseEvent, path: JsonPath, value: unknown) {
    e.stopPropagation()
    setPopover({ type: 'json', path, value, x: e.clientX + 10, y: e.clientY + 10 })
  }

  function handleXmlLeaf(e: React.MouseEvent, selector: string, value: string) {
    e.stopPropagation()
    setPopover({ type: 'xml', selector, value, x: e.clientX + 10, y: e.clientY + 10 })
  }

  const treeContent = isJson ? (() => {
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch {
      return <div className="p-4 text-xs text-surface-600">Unable to parse JSON response body</div>
    }
    return <JsonNode nodeKey={null} value={parsed} path={[]} depth={0} onLeaf={handleJsonLeaf} />
  })() : isXml ? (() => {
    const doc = new DOMParser().parseFromString(body, 'text/xml')
    const root = doc.documentElement
    if (root.tagName === 'parsererror') {
      return <div className="p-4 text-xs text-surface-600">Unable to parse XML response body</div>
    }
    return <XmlNode element={root} depth={0} onLeaf={handleXmlLeaf} />
  })() : (
    <div className="p-4 text-xs text-surface-600">Interactive tree not available for this content type. Use Raw view.</div>
  )

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 font-mono">
      {popover && (
        <AssertMenu
          state={popover}
          onClose={() => setPopover(null)}
          onConfirm={snippet => { onAssert(snippet); setPopover(null) }}
        />
      )}
      {treeContent}
    </div>
  )
}
