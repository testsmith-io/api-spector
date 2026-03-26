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

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import { hoverTooltip } from '@codemirror/view';

// ─── Built-in dynamic variables ──────────────────────────────────────────────

export const DYNAMIC_VAR_NAMES: string[] = [
  '$uuid',
  '$timestamp',
  '$isoTimestamp',
  '$randomInt',
  '$randomFloat',
  '$randomBoolean',
  '$randomEmail',
  '$randomUsername',
  '$randomPassword',
  '$randomFullName',
  '$randomFirstName',
  '$randomLastName',
  '$randomWord',
  '$randomPhrase',
  '$randomUrl',
  '$randomIp',
  '$randomHexColor',
];

const DYNAMIC_VAR_INFO: Record<string, string> = {
  $uuid:            'Random UUID v4 — generated fresh each send',
  $timestamp:       'Current Unix timestamp in milliseconds',
  $isoTimestamp:    'Current date/time as ISO 8601 string',
  $randomInt:       'Random integer between 0 and 1000',
  $randomFloat:     'Random float between 0 and 1000',
  $randomBoolean:   'Random true or false',
  $randomEmail:     'Random email address',
  $randomUsername:  'Random username',
  $randomPassword:  'Random password string',
  $randomFullName:  'Random full name',
  $randomFirstName: 'Random first name',
  $randomLastName:  'Random last name',
  $randomWord:      'Random lorem word',
  $randomPhrase:    'Random lorem sentence',
  $randomUrl:       'Random URL',
  $randomIp:        'Random IPv4 address',
  $randomHexColor:  'Random hex color (e.g. #a3f1c2)',
};

// ─── sp API ──────────────────────────────────────────────────────────────────

const AT_TOP: Completion[] = [
  { label: 'test',                type: 'function', detail: '(name, fn)',    info: 'Define a named test' },
  { label: 'expect',              type: 'function', detail: '(value)',       info: 'Create a chainable assertion' },
  { label: 'response',            type: 'property',                         info: 'HTTP response (post-request only)' },
  { label: 'variables',           type: 'property',                         info: 'Local (per-request) variable scope' },
  { label: 'environment',         type: 'property',                         info: 'Environment variable scope' },
  { label: 'collectionVariables', type: 'property',                         info: 'Collection variable scope' },
  { label: 'globals',             type: 'property',                         info: 'Global variable scope' },
];

const SCOPE_METHODS: Completion[] = [
  { label: 'get',      type: 'function', detail: '(key)',         info: 'Get a variable value' },
  { label: 'set',      type: 'function', detail: '(key, value)',  info: 'Set a variable value' },
  { label: 'clear',    type: 'function', detail: '(key)',         info: 'Delete a variable' },
  { label: 'has',      type: 'function', detail: '(key)',         info: 'Check if variable exists' },
  { label: 'toObject', type: 'function', detail: '()',            info: 'Return all variables as a plain object' },
];

const SP_RESPONSE_MEMBERS: Completion[] = [
  { label: 'code',         type: 'property', detail: 'number', info: 'HTTP status code (e.g. 200)' },
  { label: 'status',       type: 'property', detail: 'string', info: 'Status code + text (e.g. "200 OK")' },
  { label: 'statusText',   type: 'property', detail: 'string', info: 'Status text only' },
  { label: 'responseTime', type: 'property', detail: 'number', info: 'Request duration in ms' },
  { label: 'responseSize', type: 'property', detail: 'number', info: 'Body size in bytes' },
  { label: 'headers',      type: 'property',                   info: 'Response headers — use .get(name) or .toObject()' },
  { label: 'json',         type: 'function', detail: '()',     info: 'Parse body as JSON and return it' },
  { label: 'text',         type: 'function', detail: '()',     info: 'Return body as a raw string' },
];

const HEADERS_METHODS: Completion[] = [
  { label: 'get',      type: 'function', detail: '(name)', info: 'Get a header value by name (case-insensitive)' },
  { label: 'toObject', type: 'function', detail: '()',     info: 'Return all headers as a plain object' },
];

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
];

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
  location: [
    { label: 'city',          type: 'function', detail: '()', info: 'Random city name' },
    { label: 'country',       type: 'function', detail: '()', info: 'Random country name' },
    { label: 'countryCode',   type: 'function', detail: '()', info: 'Two-letter country code' },
    { label: 'state',         type: 'function', detail: '()', info: 'US state name' },
    { label: 'streetAddress', type: 'function', detail: '()', info: 'Street address' },
    { label: 'zipCode',       type: 'function', detail: '()', info: 'ZIP / postal code' },
    { label: 'latitude',      type: 'function', detail: '()', info: 'Random latitude' },
    { label: 'longitude',     type: 'function', detail: '()', info: 'Random longitude' },
  ],
  finance: [
    { label: 'iban',             type: 'function', detail: '()',          info: 'IBAN number' },
    { label: 'bic',              type: 'function', detail: '()',          info: 'BIC / SWIFT code' },
    { label: 'accountNumber',    type: 'function', detail: '()',          info: 'Bank account number' },
    { label: 'amount',           type: 'function', detail: '({ min, max })', info: 'Random monetary amount' },
    { label: 'currencyCode',     type: 'function', detail: '()',          info: 'Currency code (USD, EUR, …)' },
    { label: 'currencyName',     type: 'function', detail: '()',          info: 'Currency name' },
    { label: 'creditCardNumber', type: 'function', detail: '()',          info: 'Credit card number' },
    { label: 'pin',              type: 'function', detail: '()',          info: 'Numeric PIN' },
    { label: 'bitcoinAddress',   type: 'function', detail: '()',          info: 'Bitcoin address' },
  ],
  color: [
    { label: 'human', type: 'function', detail: '()', info: 'Human-readable color name (e.g. "red")' },
    { label: 'hex',   type: 'function', detail: '()', info: 'Hex color string (e.g. #a3f1c2)' },
    { label: 'rgb',   type: 'function', detail: '()', info: 'CSS rgb() string' },
    { label: 'hsl',   type: 'function', detail: '()', info: 'CSS hsl() string' },
  ],
};

// ─── Completion source factory ────────────────────────────────────────────────

export function makeAtCompletionSource(varNames: string[]) {
  return function atSource(context: CompletionContext): CompletionResult | null {
    const line       = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // {{varname}} — must be highest priority so it works inside strings too
    const varMatch = /\{\{(\w*)$/.exec(textBefore);
    if (varMatch) {
      const q = varMatch[1].toLowerCase();
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
      };
    }

    // at.response.headers.xxx
    const headersMatch = /\bsp\.response\.headers\.(\w*)$/.exec(textBefore);
    if (headersMatch) {
      return { from: context.pos - headersMatch[1].length, options: HEADERS_METHODS, validFor: /^\w*$/ };
    }

    // at.response.xxx
    const responseMatch = /\bsp\.response\.(\w*)$/.exec(textBefore);
    if (responseMatch) {
      return { from: context.pos - responseMatch[1].length, options: SP_RESPONSE_MEMBERS, validFor: /^\w*$/ };
    }

    // at.variables.xxx | at.environment.xxx | at.collectionVariables.xxx | at.globals.xxx
    const scopeMatch = /\bsp\.(variables|environment|collectionVariables|globals)\.(\w*)$/.exec(textBefore);
    if (scopeMatch) {
      return { from: context.pos - scopeMatch[2].length, options: SCOPE_METHODS, validFor: /^\w*$/ };
    }

    // at.xxx
    const atMatch = /\bsp\.(\w*)$/.exec(textBefore);
    if (atMatch) {
      return { from: context.pos - atMatch[1].length, options: AT_TOP, validFor: /^\w*$/ };
    }

    // faker.namespace.xxx
    const fakerSubMatch = /\bfaker\.(\w+)\.(\w*)$/.exec(textBefore);
    if (fakerSubMatch) {
      const subs = FAKER_SUB[fakerSubMatch[1]] ?? [];
      return { from: context.pos - fakerSubMatch[2].length, options: subs, validFor: /^\w*$/ };
    }

    // faker.xxx
    const fakerMatch = /\bfaker\.(\w*)$/.exec(textBefore);
    if (fakerMatch) {
      return { from: context.pos - fakerMatch[1].length, options: FAKER_NAMESPACES, validFor: /^\w*$/ };
    }

    return null;
  };
}

/** CodeMirror extension: at.* API + {{varname}} completions for script editors. */
export function atCompletionExtension(varNames: string[]) {
  return autocompletion({ override: [makeAtCompletionSource(varNames)] });
}

// ─── Hover tooltip ────────────────────────────────────────────────────────────

/**
 * CodeMirror extension: shows a tooltip with the resolved value when
 * hovering over a {{varname}} token.
 */
export function varHoverTooltipExtension(varValues: Record<string, string>) {
  return hoverTooltip((view, pos) => {
    const line      = view.state.doc.lineAt(pos);
    const lineText  = line.text;
    const posInLine = pos - line.from;

    const re = /\{\{([^}]+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      if (m.index <= posInLine && posInLine < m.index + m[0].length) {
        const name     = m[1].trim();
        const resolved = varValues[name];
        const tokenFrom = line.from + m.index;
        const tokenTo   = tokenFrom + m[0].length;

        return {
          pos: tokenFrom,
          end: tokenTo,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.style.cssText =
              'display:flex;align-items:center;gap:6px;padding:4px 10px;' +
              'font-size:11px;font-family:monospace;white-space:nowrap;';

            const nameEl = document.createElement('span');
            nameEl.style.color = '#60a5fa';
            nameEl.textContent = `{{${name}}}`;

            const arrow = document.createElement('span');
            arrow.style.color = '#6b7280';
            arrow.textContent = '→';

            const valEl = document.createElement('span');
            if (resolved !== undefined) {
              valEl.style.color = '#34d399';
              valEl.textContent = resolved.length > 60 ? resolved.slice(0, 60) + '…' : resolved;
            } else if (DYNAMIC_VAR_INFO[name]) {
              valEl.style.color = '#a78bfa';
              valEl.style.fontStyle = 'italic';
              valEl.textContent = DYNAMIC_VAR_INFO[name];
            } else {
              valEl.style.color = '#f97316';
              valEl.style.fontStyle = 'italic';
              valEl.textContent = 'undefined';
            }

            dom.appendChild(nameEl);
            dom.appendChild(arrow);
            dom.appendChild(valEl);
            return { dom };
          },
        };
      }
    }
    return null;
  });
}

/** CodeMirror extension: only {{varname}} completions, for body/raw editors. */
export function varCompletionExtension(varNames: string[]) {
  const allNames = [...DYNAMIC_VAR_NAMES, ...varNames];
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line       = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);

        // {{faker.namespace.method( — show faker sub-methods
        const fakerSubMatch = /\{\{faker\.(\w+)\.(\w*)$/.exec(textBefore);
        if (fakerSubMatch) {
          const subs = FAKER_SUB[fakerSubMatch[1]] ?? [];
          const q = fakerSubMatch[2].toLowerCase();
          return {
            from:     context.pos - fakerSubMatch[2].length,
            options:  subs
              .filter(c => c.label.toLowerCase().includes(q))
              .map(c => ({ ...c, apply: c.label + '()}}' })),
            validFor: /^\w*$/,
          };
        }

        // {{faker.namespace — show faker namespaces
        const fakerNsMatch = /\{\{faker\.(\w*)$/.exec(textBefore);
        if (fakerNsMatch) {
          const q = fakerNsMatch[1].toLowerCase();
          return {
            from:     context.pos - fakerNsMatch[1].length,
            options:  FAKER_NAMESPACES
              .filter(c => c.label.toLowerCase().includes(q))
              .map(c => ({ ...c, apply: c.label + '.', boost: 1 })),
            validFor: /^\w*$/,
          };
        }

        // {{dayjs — suggest dayjs expression starter
        const dayjsMatch = /\{\{(dayjs\b[^}]*)$/.exec(textBefore);
        if (dayjsMatch) {
          const partial = dayjsMatch[1];
          return {
            from:     context.pos - partial.length,
            options:  [
              { label: "dayjs().format('YYYY-MM-DD')",          type: 'function', apply: "dayjs().format('YYYY-MM-DD')}}", info: 'Current date as YYYY-MM-DD' },
              { label: "dayjs().toISOString()",                 type: 'function', apply: "dayjs().toISOString()}}",        info: 'Current datetime as ISO 8601' },
              { label: "dayjs().valueOf()",                      type: 'function', apply: "dayjs().valueOf()}}",            info: 'Current Unix timestamp (ms)' },
              { label: "dayjs().subtract(1,'day').format(...)",  type: 'function', apply: "dayjs().subtract(1,'day').format('YYYY-MM-DD')}}", info: 'Yesterday as YYYY-MM-DD' },
              { label: "dayjs().add(1,'day').format(...)",       type: 'function', apply: "dayjs().add(1,'day').format('YYYY-MM-DD')}}", info: 'Tomorrow as YYYY-MM-DD' },
            ],
            validFor: /^dayjs[\w().,'"-]*/,
          };
        }

        // {{varname or {{$dynamicVar or {{faker/dayjs starters
        const varMatch = /\{\{(\$?\w*)$/.exec(textBefore);
        if (!varMatch) return null;
        const q = varMatch[1].toLowerCase();

        const varOptions = allNames
          .filter(n => n.toLowerCase().includes(q))
          .map(n => ({
            label:  n,
            type:   'variable' as const,
            apply:  n + '}}',
            info:   DYNAMIC_VAR_INFO[n],
            boost:  n.startsWith('$') ? 1 : 0,
          }));

        // Also offer faker/dayjs as expression starters
        const exprStarters: Completion[] = [
          { label: 'faker',  type: 'property', apply: 'faker.',  info: 'Faker expression (e.g. faker.internet.email())',  boost: 0 },
          { label: 'dayjs',  type: 'function', apply: 'dayjs().', info: 'Day.js expression (e.g. dayjs().format(...))', boost: 0 },
        ].filter(c => c.label.includes(q));

        return {
          from:     context.pos - varMatch[1].length,
          options:  [...varOptions, ...exprStarters],
          validFor: /^\$?\w*$/,
        };
      },
    ],
  });
}

// ─── Mock body completions ────────────────────────────────────────────────────

const REQUEST_SUB: Completion[] = [
  { label: 'params',  type: 'property', apply: 'params.',   info: 'URL path params (e.g. :id → request.params.id)' },
  { label: 'query',   type: 'property', apply: 'query.',    info: 'Query string params' },
  { label: 'body',    type: 'property', apply: 'body.',     info: 'Parsed request body fields (JSON)' },
  { label: 'bodyRaw', type: 'property', apply: 'bodyRaw}}', info: 'Raw request body as string' },
  { label: 'method',  type: 'property', apply: 'method}}',  info: 'HTTP method (GET, POST, …)' },
  { label: 'path',    type: 'property', apply: 'path}}',    info: 'Request URL path' },
  { label: 'headers', type: 'property', apply: 'headers.',  info: 'Request headers object' },
];

/**
 * CodeMirror extension for mock response body editors.
 * Provides {{request.params.xxx}}, {{request.query.xxx}}, {{faker.xxx()}}, {{dayjs()…}}.
 * @param pathParamNames  param names extracted from the route pattern (e.g. ['id', 'slug'])
 * @param varNames        environment / collection variable names
 */
export function mockBodyCompletionExtension(pathParamNames: string[] = [], varNames: string[] = []) {
  const allVarNames = [...DYNAMIC_VAR_NAMES, ...varNames];

  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line       = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);

        // {{request.params.xxx — suggest path param names
        const paramsMatch = /\{\{request\.params\.(\w*)$/.exec(textBefore);
        if (paramsMatch) {
          const q = paramsMatch[1].toLowerCase();
          return {
            from:    context.pos - paramsMatch[1].length,
            options: pathParamNames
              .filter(n => n.toLowerCase().includes(q))
              .map(n => ({ label: n, type: 'variable' as const, apply: n + '}}', info: `Path param :${n}`, boost: 2 })),
            validFor: /^\w*$/,
          };
        }

        // {{request.query.xxx / {{request.body.xxx / {{request.headers.xxx — generic key hints
        const reqSubMatch = /\{\{request\.(query|body|headers)\.(\w*)$/.exec(textBefore);
        if (reqSubMatch) {
          const q = reqSubMatch[2].toLowerCase();
          const generic: Completion[] = [
            { label: 'id',    type: 'variable', apply: 'id}}'    },
            { label: 'name',  type: 'variable', apply: 'name}}'  },
            { label: 'value', type: 'variable', apply: 'value}}' },
          ].filter(c => c.label.includes(q));
          return { from: context.pos - reqSubMatch[2].length, options: generic, validFor: /^\w*$/ };
        }

        // {{request.xxx — suggest sub-properties
        const requestMatch = /\{\{request\.(\w*)$/.exec(textBefore);
        if (requestMatch) {
          const q = requestMatch[1].toLowerCase();
          return {
            from:    context.pos - requestMatch[1].length,
            options: REQUEST_SUB.filter(o => o.label.toLowerCase().includes(q)),
            validFor: /^\w*$/,
          };
        }

        // {{faker.namespace.method
        const fakerSubMatch = /\{\{faker\.(\w+)\.(\w*)$/.exec(textBefore);
        if (fakerSubMatch) {
          const subs = FAKER_SUB[fakerSubMatch[1]] ?? [];
          const q    = fakerSubMatch[2].toLowerCase();
          return {
            from:    context.pos - fakerSubMatch[2].length,
            options: subs
              .filter(c => c.label.toLowerCase().includes(q))
              .map(c => ({ ...c, apply: c.label + '()}}' })),
            validFor: /^\w*$/,
          };
        }

        // {{faker.namespace
        const fakerNsMatch = /\{\{faker\.(\w*)$/.exec(textBefore);
        if (fakerNsMatch) {
          const q = fakerNsMatch[1].toLowerCase();
          return {
            from:    context.pos - fakerNsMatch[1].length,
            options: FAKER_NAMESPACES
              .filter(c => c.label.toLowerCase().includes(q))
              .map(c => ({ ...c, apply: c.label + '.', boost: 1 })),
            validFor: /^\w*$/,
          };
        }

        // {{dayjs
        const dayjsMatch = /\{\{(dayjs\b[^}]*)$/.exec(textBefore);
        if (dayjsMatch) {
          return {
            from:    context.pos - dayjsMatch[1].length,
            options: [
              { label: "dayjs().format('YYYY-MM-DD')", type: 'function' as const, apply: "dayjs().format('YYYY-MM-DD')}}", info: 'Current date' },
              { label: "dayjs().toISOString()",         type: 'function' as const, apply: "dayjs().toISOString()}}",        info: 'ISO datetime' },
              { label: "dayjs().valueOf()",              type: 'function' as const, apply: "dayjs().valueOf()}}",            info: 'Unix timestamp ms' },
            ],
            validFor: /^dayjs[\w().,'"-]*/,
          };
        }

        // {{varname / {{$dynamic / starters (request, faker, dayjs)
        const varMatch = /\{\{(\$?\w*)$/.exec(textBefore);
        if (!varMatch) return null;
        const q = varMatch[1].toLowerCase();

        const varOptions = allVarNames
          .filter(n => n.toLowerCase().includes(q))
          .map(n => ({ label: n, type: 'variable' as const, apply: n + '}}', info: DYNAMIC_VAR_INFO[n], boost: n.startsWith('$') ? 1 : 0 }));

        const starters: Completion[] = [
          { label: 'request', type: 'property', apply: 'request.', info: 'Incoming request context', boost: 2 },
          { label: 'faker',   type: 'property', apply: 'faker.',   info: 'Faker.js data generators', boost: 0 },
          { label: 'dayjs',   type: 'function', apply: 'dayjs().',  info: 'Day.js date expressions',  boost: 0 },
        ].filter(c => c.label.toLowerCase().includes(q));

        return {
          from:     context.pos - varMatch[1].length,
          options:  [...varOptions, ...starters],
          validFor: /^\$?\w*$/,
        };
      },
    ],
  });
}

// ─── Mock script completions ──────────────────────────────────────────────────

const RESPONSE_MEMBERS: Completion[] = [
  { label: 'statusCode', type: 'property', detail: 'number', info: 'HTTP status code to send' },
  { label: 'body',       type: 'property', detail: 'string', info: 'Response body string (overrides template)' },
  { label: 'headers',    type: 'property', detail: 'object', info: 'Response headers — modify with response.headers["X-Foo"] = "bar"' },
];

const REQUEST_SCRIPT_MEMBERS: Completion[] = [
  { label: 'params',  type: 'property', info: 'URL path params { id, slug, … }' },
  { label: 'query',   type: 'property', info: 'Query string params { search, page, … }' },
  { label: 'body',    type: 'property', info: 'Parsed JSON request body' },
  { label: 'bodyRaw', type: 'property', info: 'Raw request body string' },
  { label: 'method',  type: 'property', info: 'HTTP method' },
  { label: 'path',    type: 'property', info: 'Request URL path' },
  { label: 'headers', type: 'property', info: 'Request headers object' },
];

/**
 * CodeMirror extension for mock pre-response script editors.
 * Provides completions for request.xxx, response.xxx, faker.xxx, dayjs().
 */
export function mockScriptCompletionExtension() {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line       = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);

        // response.xxx
        const responseMatch = /\bresponse\.(\w*)$/.exec(textBefore);
        if (responseMatch) {
          return { from: context.pos - responseMatch[1].length, options: RESPONSE_MEMBERS, validFor: /^\w*$/ };
        }

        // request.params.xxx / request.query.xxx etc — just hint at generic keys
        if (/\brequest\.(params|query|body|headers)\.(\w*)$/.test(textBefore)) {
          return null; // let the user type freely
        }

        // request.xxx
        const requestScriptMatch = /\brequest\.(\w*)$/.exec(textBefore);
        if (requestScriptMatch) {
          return { from: context.pos - requestScriptMatch[1].length, options: REQUEST_SCRIPT_MEMBERS, validFor: /^\w*$/ };
        }

        // faker.namespace.method
        const fakerSubMatch = /\bfaker\.(\w+)\.(\w*)$/.exec(textBefore);
        if (fakerSubMatch) {
          const subs = FAKER_SUB[fakerSubMatch[1]] ?? [];
          const q    = fakerSubMatch[2].toLowerCase();
          return { from: context.pos - fakerSubMatch[2].length, options: subs.filter(c => c.label.toLowerCase().includes(q)), validFor: /^\w*$/ };
        }

        // faker.namespace
        const fakerNsMatch = /\bfaker\.(\w*)$/.exec(textBefore);
        if (fakerNsMatch) {
          const q = fakerNsMatch[1].toLowerCase();
          return {
            from:    context.pos - fakerNsMatch[1].length,
            options: FAKER_NAMESPACES.filter(c => c.label.toLowerCase().includes(q)),
            validFor: /^\w*$/,
          };
        }

        return null;
      },
    ],
  });
}
