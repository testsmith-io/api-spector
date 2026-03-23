import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { autocompletion } from '@codemirror/autocomplete'
import { hoverTooltip } from '@codemirror/view'

// ─── sp API ──────────────────────────────────────────────────────────────────

const AT_TOP: Completion[] = [
  { label: 'test',                type: 'function', detail: '(name, fn)',    info: 'Define a named test' },
  { label: 'expect',              type: 'function', detail: '(value)',       info: 'Create a chainable assertion' },
  { label: 'response',            type: 'property',                         info: 'HTTP response (post-request only)' },
  { label: 'variables',           type: 'property',                         info: 'Local (per-request) variable scope' },
  { label: 'environment',         type: 'property',                         info: 'Environment variable scope' },
  { label: 'collectionVariables', type: 'property',                         info: 'Collection variable scope' },
  { label: 'globals',             type: 'property',                         info: 'Global variable scope' },
]

const SCOPE_METHODS: Completion[] = [
  { label: 'get',      type: 'function', detail: '(key)',         info: 'Get a variable value' },
  { label: 'set',      type: 'function', detail: '(key, value)',  info: 'Set a variable value' },
  { label: 'clear',    type: 'function', detail: '(key)',         info: 'Delete a variable' },
  { label: 'has',      type: 'function', detail: '(key)',         info: 'Check if variable exists' },
  { label: 'toObject', type: 'function', detail: '()',            info: 'Return all variables as a plain object' },
]

const RESPONSE_MEMBERS: Completion[] = [
  { label: 'code',         type: 'property', detail: 'number', info: 'HTTP status code (e.g. 200)' },
  { label: 'status',       type: 'property', detail: 'string', info: 'Status code + text (e.g. "200 OK")' },
  { label: 'statusText',   type: 'property', detail: 'string', info: 'Status text only' },
  { label: 'responseTime', type: 'property', detail: 'number', info: 'Request duration in ms' },
  { label: 'responseSize', type: 'property', detail: 'number', info: 'Body size in bytes' },
  { label: 'headers',      type: 'property',                   info: 'Response headers — use .get(name) or .toObject()' },
  { label: 'json',         type: 'function', detail: '()',     info: 'Parse body as JSON and return it' },
  { label: 'text',         type: 'function', detail: '()',     info: 'Return body as a raw string' },
]

const HEADERS_METHODS: Completion[] = [
  { label: 'get',      type: 'function', detail: '(name)', info: 'Get a header value by name (case-insensitive)' },
  { label: 'toObject', type: 'function', detail: '()',     info: 'Return all headers as a plain object' },
]

// ─── faker ───────────────────────────────────────────────────────────────────

const FAKER_NAMESPACES: Completion[] = [
  { label: 'string',   type: 'property', info: 'String generators' },
  { label: 'number',   type: 'property', info: 'Number generators' },
  { label: 'person',   type: 'property', info: 'Names, titles, etc.' },
  { label: 'internet', type: 'property', info: 'Emails, URLs, IPs, etc.' },
  { label: 'date',     type: 'property', info: 'Date generators' },
  { label: 'lorem',    type: 'property', info: 'Lorem ipsum text' },
  { label: 'location', type: 'property', info: 'Addresses, cities, countries' },
  { label: 'finance',  type: 'property', info: 'Credit cards, currency, etc.' },
  { label: 'color',    type: 'property', info: 'Color values' },
]

const FAKER_SUB: Record<string, Completion[]> = {
  string: [
    { label: 'uuid',         type: 'function', detail: '()',         info: 'Random UUID v4' },
    { label: 'alphanumeric', type: 'function', detail: '(length)',   info: 'Random alphanumeric string' },
    { label: 'alpha',        type: 'function', detail: '(options)',  info: 'Random letters only' },
    { label: 'numeric',      type: 'function', detail: '(length)',   info: 'Random digits only' },
    { label: 'sample',       type: 'function', detail: '()',         info: 'Random string sample' },
  ],
  number: [
    { label: 'int',   type: 'function', detail: '({ min, max })', info: 'Random integer' },
    { label: 'float', type: 'function', detail: '({ min, max })', info: 'Random float' },
  ],
  person: [
    { label: 'fullName',  type: 'function', detail: '()', info: 'Full name' },
    { label: 'firstName', type: 'function', detail: '()', info: 'First name' },
    { label: 'lastName',  type: 'function', detail: '()', info: 'Last name' },
    { label: 'jobTitle',  type: 'function', detail: '()', info: 'Job title' },
  ],
  internet: [
    { label: 'email',    type: 'function', detail: '()', info: 'Random email address' },
    { label: 'url',      type: 'function', detail: '()', info: 'Random URL' },
    { label: 'ip',       type: 'function', detail: '()', info: 'Random IPv4 address' },
    { label: 'username', type: 'function', detail: '()', info: 'Random username' },
    { label: 'password', type: 'function', detail: '(length)', info: 'Random password' },
  ],
  date: [
    { label: 'past',    type: 'function', detail: '(years?)', info: 'Random past date' },
    { label: 'future',  type: 'function', detail: '(years?)', info: 'Random future date' },
    { label: 'recent',  type: 'function', detail: '(days?)',  info: 'Recent date' },
    { label: 'between', type: 'function', detail: '(from, to)', info: 'Random date in range' },
  ],
  lorem: [
    { label: 'word',      type: 'function', detail: '()',      info: 'Single lorem word' },
    { label: 'words',     type: 'function', detail: '(count)', info: 'Multiple lorem words' },
    { label: 'sentence',  type: 'function', detail: '()',      info: 'Lorem sentence' },
    { label: 'paragraph', type: 'function', detail: '()',      info: 'Lorem paragraph' },
  ],
}

// ─── Completion source factory ────────────────────────────────────────────────

export function makeAtCompletionSource(varNames: string[]) {
  return function atSource(context: CompletionContext): CompletionResult | null {
    const line       = context.state.doc.lineAt(context.pos)
    const textBefore = line.text.slice(0, context.pos - line.from)

    // {{varname}} — must be highest priority so it works inside strings too
    const varMatch = /\{\{(\w*)$/.exec(textBefore)
    if (varMatch) {
      const q = varMatch[1].toLowerCase()
      return {
        from:    context.pos - varMatch[1].length,
        options: varNames
          .filter(n => n.toLowerCase().includes(q))
          .map(n => ({
            label:  n,
            type:   'variable',
            apply:  n + '}}',
            boost:  2,
          })),
        validFor: /^\w*$/,
      }
    }

    // at.response.headers.xxx
    const headersMatch = /\bsp\.response\.headers\.(\w*)$/.exec(textBefore)
    if (headersMatch) {
      return { from: context.pos - headersMatch[1].length, options: HEADERS_METHODS, validFor: /^\w*$/ }
    }

    // at.response.xxx
    const responseMatch = /\bsp\.response\.(\w*)$/.exec(textBefore)
    if (responseMatch) {
      return { from: context.pos - responseMatch[1].length, options: RESPONSE_MEMBERS, validFor: /^\w*$/ }
    }

    // at.variables.xxx | at.environment.xxx | at.collectionVariables.xxx | at.globals.xxx
    const scopeMatch = /\bsp\.(variables|environment|collectionVariables|globals)\.(\w*)$/.exec(textBefore)
    if (scopeMatch) {
      return { from: context.pos - scopeMatch[2].length, options: SCOPE_METHODS, validFor: /^\w*$/ }
    }

    // at.xxx
    const atMatch = /\bsp\.(\w*)$/.exec(textBefore)
    if (atMatch) {
      return { from: context.pos - atMatch[1].length, options: AT_TOP, validFor: /^\w*$/ }
    }

    // faker.namespace.xxx
    const fakerSubMatch = /\bfaker\.(\w+)\.(\w*)$/.exec(textBefore)
    if (fakerSubMatch) {
      const subs = FAKER_SUB[fakerSubMatch[1]] ?? []
      return { from: context.pos - fakerSubMatch[2].length, options: subs, validFor: /^\w*$/ }
    }

    // faker.xxx
    const fakerMatch = /\bfaker\.(\w*)$/.exec(textBefore)
    if (fakerMatch) {
      return { from: context.pos - fakerMatch[1].length, options: FAKER_NAMESPACES, validFor: /^\w*$/ }
    }

    return null
  }
}

/** CodeMirror extension: at.* API + {{varname}} completions for script editors. */
export function atCompletionExtension(varNames: string[]) {
  return autocompletion({ override: [makeAtCompletionSource(varNames)] })
}

// ─── Hover tooltip ────────────────────────────────────────────────────────────

/**
 * CodeMirror extension: shows a tooltip with the resolved value when
 * hovering over a {{varname}} token.
 */
export function varHoverTooltipExtension(varValues: Record<string, string>) {
  return hoverTooltip((view, pos) => {
    const line      = view.state.doc.lineAt(pos)
    const lineText  = line.text
    const posInLine = pos - line.from

    const re = /\{\{([^}]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(lineText)) !== null) {
      if (m.index <= posInLine && posInLine < m.index + m[0].length) {
        const name     = m[1].trim()
        const resolved = varValues[name]
        const tokenFrom = line.from + m.index
        const tokenTo   = tokenFrom + m[0].length

        return {
          pos: tokenFrom,
          end: tokenTo,
          above: true,
          create() {
            const dom = document.createElement('div')
            dom.style.cssText =
              'display:flex;align-items:center;gap:6px;padding:4px 10px;' +
              'font-size:11px;font-family:monospace;white-space:nowrap;'

            const nameEl = document.createElement('span')
            nameEl.style.color = '#60a5fa'
            nameEl.textContent = `{{${name}}}`

            const arrow = document.createElement('span')
            arrow.style.color = '#6b7280'
            arrow.textContent = '→'

            const valEl = document.createElement('span')
            if (resolved !== undefined) {
              valEl.style.color = '#34d399'
              valEl.textContent = resolved.length > 60 ? resolved.slice(0, 60) + '…' : resolved
            } else {
              valEl.style.color = '#f97316'
              valEl.style.fontStyle = 'italic'
              valEl.textContent = 'undefined'
            }

            dom.appendChild(nameEl)
            dom.appendChild(arrow)
            dom.appendChild(valEl)
            return { dom }
          },
        }
      }
    }
    return null
  })
}

/** CodeMirror extension: only {{varname}} completions, for body/raw editors. */
export function varCompletionExtension(varNames: string[]) {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line       = context.state.doc.lineAt(context.pos)
        const textBefore = line.text.slice(0, context.pos - line.from)
        const varMatch   = /\{\{(\w*)$/.exec(textBefore)
        if (!varMatch) return null
        const q = varMatch[1].toLowerCase()
        return {
          from:    context.pos - varMatch[1].length,
          options: varNames
            .filter(n => n.toLowerCase().includes(q))
            .map(n => ({ label: n, type: 'variable', apply: n + '}}' })),
          validFor: /^\w*$/,
        }
      },
    ],
  })
}
