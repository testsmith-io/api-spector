// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import { hoverTooltip, showTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { FAKER_NS_ALL, FAKER_ALL } from './fakerCatalog';

// Built-in dynamic variables

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

export const DYNAMIC_VAR_INFO: Record<string, string> = {
  $uuid:            'Random UUID v4 - generated fresh each send',
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

// sp API

// Top-level identifiers available in a script, offered on Ctrl+Space and while
// typing in a neutral position. `apply` adds the member dot / call parens.
const TOP_LEVEL_GLOBALS: Completion[] = [
  { label: 'sp',      type: 'namespace', apply: 'sp.',      info: 'API Spector scripting API', boost: 2 },
  { label: 'faker',   type: 'namespace', apply: 'faker.',   info: 'Fake data generators' },
  { label: 'dayjs',   type: 'function',  apply: 'dayjs()',  info: 'Date/time library' },
  { label: 'console', type: 'namespace', apply: 'console.', info: 'log / warn / error / info' },
  { label: 'tv4',     type: 'namespace', apply: 'tv4.',     info: 'JSON Schema validation' },
  { label: 'JSON',    type: 'namespace', apply: 'JSON.' },
  { label: 'Math',    type: 'namespace', apply: 'Math.' },
];

const AT_TOP: Completion[] = [
  { label: 'test',                type: 'function', detail: '(name, fn)',    info: 'Define a named test' },
  { label: 'expect',              type: 'function', detail: '(value)',       info: 'Create a chainable assertion' },
  { label: 'response',            type: 'property',                         info: 'HTTP response (post-request only)' },
  { label: 'variables',           type: 'property',                         info: 'Local (per-request) variable scope' },
  { label: 'environment',         type: 'property',                         info: 'Environment variable scope' },
  { label: 'collectionVariables', type: 'property',                         info: 'Collection variable scope' },
  { label: 'folder',              type: 'property',                         info: 'Folder variable scope (shared by requests in the same folder during a run)' },
  { label: 'globals',             type: 'property',                         info: 'Global variable scope' },
  { label: 'sendRequest',         type: 'function', detail: '(urlOrReq, cb?)', info: 'Send an HTTP request from the script (await it or pass a callback)' },
  { label: 'require',             type: 'function', detail: '(name)',       info: 'Load a reusable library (or npm package)' },
  { label: 'jsonPath',            type: 'function', detail: '(data, expr)',  info: 'Query a value with a JSONPath expression' },
  { label: 'totp',                type: 'function', detail: '(secret, opts?)', info: 'Generate a TOTP code from a base32 secret' },
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
  { label: 'headers',      type: 'property',                   info: 'Response headers - use .get(name) or .toObject()' },
  { label: 'json',         type: 'function', detail: '()',     info: 'Parse body as JSON and return it' },
  { label: 'text',         type: 'function', detail: '()',     info: 'Return body as a raw string' },
];

const HEADERS_METHODS: Completion[] = [
  { label: 'get',      type: 'function', detail: '(name)', info: 'Get a header value by name (case-insensitive)' },
  { label: 'toObject', type: 'function', detail: '()',     info: 'Return all headers as a plain object' },
];

// Parameter hints for dayjs methods that take arguments. Drives both the
// completion detail and the signatureHelp tooltip; a method absent here is a
// no-arg method. Scoped to a dayjs(...) chain so generic names (add/get/set) do
// not mis-hint on unrelated objects.
const DAYJS_SIGS: Record<string, string> = {
  format:   '(template?)',
  add:      '(value, unit)',
  subtract: '(value, unit)',
  diff:     '(date, unit?, asFloat?)',
  startOf:  '(unit)',
  endOf:    '(unit)',
  isBefore: '(date, unit?)',
  isAfter:  '(date, unit?)',
  isSame:   '(date, unit?)',
  get:      '(unit)',
  set:      '(unit, value)',
};

// A dayjs method completion that inserts `name()` and leaves the cursor inside
// the parens for methods that take arguments (so the signature tooltip shows at
// once and the user does not type the parens), or after them for no-arg methods.
function dayjsMethod(label: string, info: string): Completion {
  const sig = DAYJS_SIGS[label];
  return {
    label, type: 'function', detail: sig ?? '()', info,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const anchor = from + label.length + (sig ? 1 : 2);
      view.dispatch({ changes: { from, to, insert: `${label}()` }, selection: { anchor } });
      // The signature tooltip is computed from the cursor-in-parens selection,
      // but it does not surface during the completion-accept update. Re-assert
      // the selection on the next tick (a standalone selection transaction, like
      // a manual click into the parens) so the hint renders.
      if (sig) setTimeout(() => { try { view.dispatch({ selection: { anchor } }); } catch { /* view gone */ } }, 0);
    },
  };
}

// dayjs() instance methods (core, plugin-free). Offered after a dayjs(...) call,
// so `dayjs().` and chained `dayjs().add(1,'day').` complete.
const DAYJS_METHODS: Completion[] = [
  dayjsMethod('format',      'Format the date, e.g. format("YYYY-MM-DD HH:mm")'),
  dayjsMethod('toISOString', 'ISO 8601 string in UTC'),
  dayjsMethod('valueOf',     'Unix timestamp in milliseconds'),
  dayjsMethod('unix',        'Unix timestamp in seconds'),
  dayjsMethod('toDate',      'Native Date object'),
  dayjsMethod('toString',    'Date as a string'),
  dayjsMethod('add',         'Add time, e.g. add(1, "day")'),
  dayjsMethod('subtract',    'Subtract time, e.g. subtract(2, "hour")'),
  dayjsMethod('diff',        'Difference from another date'),
  dayjsMethod('startOf',     'Start of a unit, e.g. startOf("day")'),
  dayjsMethod('endOf',       'End of a unit, e.g. endOf("month")'),
  dayjsMethod('isBefore',    'Whether this date is before another'),
  dayjsMethod('isAfter',     'Whether this date is after another'),
  dayjsMethod('isSame',      'Whether this date equals another'),
  dayjsMethod('isValid',     'Whether the date is valid'),
  dayjsMethod('year',        'Get the year'),
  dayjsMethod('month',       'Get the month (0-11)'),
  dayjsMethod('date',        'Get the day of the month'),
  dayjsMethod('day',         'Get the day of the week (0-6)'),
  dayjsMethod('hour',        'Get the hour'),
  dayjsMethod('minute',      'Get the minute'),
  dayjsMethod('second',      'Get the second'),
  dayjsMethod('get',         'Get a unit value'),
  dayjsMethod('set',         'Set a unit value'),
  dayjsMethod('clone',       'Clone the dayjs object'),
];

// The time-unit argument shared by dayjs add/subtract/startOf/endOf/diff/get/set.
const DAYJS_UNITS: Completion[] = [
  'year', 'quarter', 'month', 'week', 'day', 'date', 'hour', 'minute', 'second', 'millisecond',
].map(label => ({ label, type: 'enum', info: 'dayjs time unit' }));

// chai assertion chain (sp.expect(...).to.be.equal(...))
// Language chains pass through; leaf methods/getters check. We offer context-aware
// members after each chain link so `sp.expect(x).` keeps completing.

const CHAI_METHODS: Completion[] = [
  { label: 'equal',    type: 'function', detail: '(value)',       info: 'Strict (===) equality' },
  { label: 'eql',      type: 'function', detail: '(value)',       info: 'Deep equality' },
  { label: 'include',  type: 'function', detail: '(value)',       info: 'Target includes value (string / array / object)' },
  { label: 'contain',  type: 'function', detail: '(value)',       info: 'Alias of include' },
  { label: 'match',    type: 'function', detail: '(regexp)',      info: 'String matches a regular expression' },
  { label: 'above',    type: 'function', detail: '(n)',           info: 'Greater than n' },
  { label: 'below',    type: 'function', detail: '(n)',           info: 'Less than n' },
  { label: 'least',    type: 'function', detail: '(n)',           info: 'Greater than or equal to n' },
  { label: 'most',     type: 'function', detail: '(n)',           info: 'Less than or equal to n' },
  { label: 'within',   type: 'function', detail: '(min, max)',    info: 'Number within an inclusive range' },
  { label: 'closeTo',  type: 'function', detail: '(expected, delta)', info: 'Number close to expected within delta' },
  { label: 'a',        type: 'function', detail: "(type)",        info: "Type check, e.g. .to.be.a('string')" },
  { label: 'an',       type: 'function', detail: "(type)",        info: "Type check, e.g. .to.be.an('array')" },
  { label: 'property', type: 'function', detail: '(name, [value])', info: 'Object has a property (optionally equal to value)' },
  { label: 'lengthOf', type: 'function', detail: '(n)',           info: 'Array / string length equals n' },
  { label: 'keys',     type: 'function', detail: '(...keys)',     info: 'Object has the given keys' },
  { label: 'members',  type: 'function', detail: '(array)',       info: 'Array has the given members' },
  { label: 'oneOf',    type: 'function', detail: '(array)',       info: 'Value is one of the array' },
  { label: 'throw',    type: 'function', detail: '([error])',     info: 'Function throws' },
  { label: 'satisfy',  type: 'function', detail: '(fn)',          info: 'Value satisfies a predicate' },
];

const CHAI_GETTERS: Completion[] = [
  { label: 'true',      type: 'property', info: 'Value is true' },
  { label: 'false',     type: 'property', info: 'Value is false' },
  { label: 'null',      type: 'property', info: 'Value is null' },
  { label: 'undefined', type: 'property', info: 'Value is undefined' },
  { label: 'NaN',       type: 'property', info: 'Value is NaN' },
  { label: 'ok',        type: 'property', info: 'Value is truthy' },
  { label: 'empty',     type: 'property', info: 'Array / string / object is empty' },
  { label: 'exist',     type: 'property', info: 'Value is neither null nor undefined' },
];

/** Language-chain words offered as sub-property continuations. */
const chaiWords = (words: string[]): Completion[] =>
  words.map(w => ({ label: w, type: 'property', info: 'Chai chain' }));
const chaiPick = (labels: string[]): Completion[] =>
  CHAI_METHODS.filter(c => labels.includes(c.label));

// What to offer based on the last word in the chain (before the partial being typed).
const CHAI_AFTER: Record<string, Completion[]> = {
  '':     [...chaiWords(['to', 'not']), ...chaiPick(['equal'])],           // right after expect(...)
  to:     [...chaiWords(['be', 'have', 'include', 'deep', 'not', 'a', 'an']), ...CHAI_METHODS],
  not:    [...chaiWords(['be', 'have', 'include', 'deep', 'a', 'an']), ...CHAI_METHODS],
  be:     [...CHAI_GETTERS, ...chaiPick(['above', 'below', 'within', 'a', 'an', 'oneOf', 'closeTo', 'empty'])],
  been:   [...CHAI_GETTERS, ...chaiPick(['above', 'below', 'within'])],
  have:   chaiPick(['property', 'lengthOf', 'keys', 'members']),
  has:    chaiPick(['property', 'lengthOf', 'keys', 'members']),
  deep:   chaiPick(['equal', 'include', 'members', 'property']),
};
const CHAI_DEFAULT: Completion[] = [
  ...chaiWords(['to', 'be', 'have', 'include', 'not', 'deep']),
  ...CHAI_METHODS,
  ...CHAI_GETTERS,
];

/** Complete the chai chain after a balanced `sp.expect( … )`. Returns null when
 *  the cursor is not on a `.member` right after a completed expect() call. */
function chaiChainCompletion(textBefore: string, pos: number): CompletionResult | null {
  const start = textBefore.lastIndexOf('sp.expect(');
  if (start === -1) return null;

  // Scan for the matching ')' of expect( so the argument can itself contain
  // parens/dots.
  let depth = 0, close = -1;
  for (let i = start + 'sp.expect'.length; i < textBefore.length; i++) {
    const ch = textBefore[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return null; // still typing the expect() argument

  const chain = textBefore.slice(close + 1); // e.g. ".to.be.bel"
  const m = /^((?:\.\w+)*)\.(\w*)$/.exec(chain);
  if (!m) return null; // not a plain .word chain (e.g. after a method call)

  const priorWords = m[1] ? m[1].split('.').filter(Boolean) : [];
  const lastWord   = priorWords.length ? priorWords[priorWords.length - 1] : '';
  const partial    = m[2].toLowerCase();
  const options    = (CHAI_AFTER[lastWord] ?? CHAI_DEFAULT)
    .filter(o => o.label.toLowerCase().includes(partial));

  return { from: pos - m[2].length, options, validFor: /^\w*$/ };
}

// faker

// Short descriptions for common namespaces; the rest fall back to a generic hint.
const CURATED_NS_INFO: Record<string, string> = {
  string: 'String generators', number: 'Number generators', person: 'Names, titles, etc.',
  internet: 'Emails, URLs, IPs, etc.', date: 'Date generators', lorem: 'Lorem ipsum text',
  location: 'Addresses, cities, countries', finance: 'Credit cards, currency, etc.',
  color: 'Color values', company: 'Company names, catch phrases',
  commerce: 'Products, prices, departments', image: 'Image URLs / placeholders',
  system: 'File names, MIME types, semver', helpers: 'Utility helpers (slugify, arrayElement, …)',
};

// Hand-written detail/info for the most-used generators, merged over the full catalogue.
const CURATED_SUB: Record<string, Completion[]> = {
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
    { label: 'word',       type: 'function', detail: '()',           info: 'Single lorem word' },
    { label: 'words',      type: 'function', detail: '(count?)',     info: 'Multiple lorem words' },
    { label: 'sentence',   type: 'function', detail: '()',           info: 'Lorem sentence' },
    { label: 'sentences',  type: 'function', detail: '(count?)',     info: 'Multiple lorem sentences' },
    { label: 'paragraph',  type: 'function', detail: '()',           info: 'Lorem paragraph' },
    { label: 'paragraphs', type: 'function', detail: '(count?)',     info: 'Multiple lorem paragraphs' },
    { label: 'slug',       type: 'function', detail: '(words?)',     info: 'Kebab-case slug from random words (e.g. "magnam-officia-laborum")' },
    { label: 'lines',      type: 'function', detail: '(count?)',     info: 'Random lines of text' },
    { label: 'text',       type: 'function', detail: '()',           info: 'Random lorem ipsum text' },
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
  company: [
    { label: 'name',         type: 'function', detail: '()', info: 'Random company name' },
    { label: 'catchPhrase',  type: 'function', detail: '()', info: 'Random business catch phrase' },
    { label: 'buzzPhrase',   type: 'function', detail: '()', info: 'Marketing-style buzz phrase' },
  ],
  commerce: [
    { label: 'productName',  type: 'function', detail: '()',     info: 'Random product name' },
    { label: 'product',      type: 'function', detail: '()',     info: 'Single product noun' },
    { label: 'department',   type: 'function', detail: '()',     info: 'Department name' },
    { label: 'price',        type: 'function', detail: '({min, max, dec, symbol}?)', info: 'Random price (string)' },
    { label: 'productDescription', type: 'function', detail: '()', info: 'Product description' },
    { label: 'isbn',         type: 'function', detail: '()',     info: 'ISBN-10 or ISBN-13' },
  ],
  image: [
    { label: 'avatar',       type: 'function', detail: '()',                info: 'Avatar URL' },
    { label: 'url',          type: 'function', detail: '({width, height}?)', info: 'Placeholder image URL' },
    { label: 'urlLoremFlickr', type: 'function', detail: '({category}?)',   info: 'LoremFlickr URL by category' },
  ],
  system: [
    { label: 'fileName',  type: 'function', detail: '()', info: 'Random file name with extension' },
    { label: 'mimeType',  type: 'function', detail: '()', info: 'Random MIME type' },
    { label: 'semver',    type: 'function', detail: '()', info: 'Random semver string' },
    { label: 'directoryPath', type: 'function', detail: '()', info: 'Random directory path' },
  ],
  helpers: [
    { label: 'slugify',      type: 'function', detail: '(text)',     info: 'Convert any string to a URL slug (lower-case, dashes, no diacritics)' },
    { label: 'arrayElement', type: 'function', detail: '(arr)',      info: 'Random element from an array' },
    { label: 'arrayElements',type: 'function', detail: '(arr, n?)',  info: 'Multiple random elements' },
    { label: 'shuffle',      type: 'function', detail: '(arr)',      info: 'Shuffled copy of the array' },
    { label: 'replaceSymbols',type: 'function', detail: '("###?")',  info: 'Replace # / ? / * with random chars' },
    { label: 'fromRegExp',   type: 'function', detail: '(regex)',    info: 'Generate a string matching a regex' },
    { label: 'multiple',     type: 'function', detail: '(fn, {count}?)', info: 'Call a generator multiple times' },
  ],
};

// Full catalogue: every faker namespace/method from the installed version, with curated info overlaid.
export const FAKER_NAMESPACES: Completion[] = FAKER_NS_ALL.map(ns => ({
  label: ns,
  type:  'property',
  info:  CURATED_NS_INFO[ns] ?? `faker.${ns} generators`,
}));

export const FAKER_SUB: Record<string, Completion[]> = Object.fromEntries(
  FAKER_NS_ALL.map(ns => {
    const curated = new Map((CURATED_SUB[ns] ?? []).map(c => [c.label, c] as const));
    const items = (FAKER_ALL[ns] ?? []).map(name =>
      curated.get(name) ?? ({ label: name, type: 'function', detail: '()' } as Completion));
    return [ns, items] as [string, Completion[]];
  }),
);

// Libraries (sp.require)

/** Exported symbol names from a TypeScript library source, by shallow scan.
 *  Handles `export const/let/var/function/class NAME`, `export { a, b as c }`
 *  and `export default`. Good enough to drive member completion. */
export function parseLibraryExports(code: string): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg || seg.startsWith('type ')) continue;
      const asMatch = /\bas\s+([A-Za-z_$][\w$]*)/.exec(seg);
      const name = asMatch ? asMatch[1] : seg.split(/\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') names.add(name);
    }
  }
  return [...names];
}

export interface LibrarySource { name: string; code: string }

/** Balanced `(...)` contents starting at the `(` at `openIdx`. */
function balancedParens(code: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return code.slice(openIdx + 1, i); }
  }
  return '';
}

/** Parameter signatures for a library's exported functions, as name -> "(params)".
 *  Covers `export function f(...)`, `export const f = (...) =>` and
 *  `export const f = function(...)`. Whitespace/newlines in params are collapsed. */
export function parseLibrarySignatures(code: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (name: string, openIdx: number) => {
    const params = balancedParens(code, openIdx).replace(/\s+/g, ' ').trim();
    out[name] = `(${params})`;
  };
  let m: RegExpExecArray | null;
  const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = reFn.exec(code))) add(m[1], reFn.lastIndex - 1);
  const reConst = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$]*\s*)?\(/g;
  while ((m = reConst.exec(code))) add(m[1], reConst.lastIndex - 1);
  return out;
}

/** The function name of the innermost unclosed call ending at the cursor, e.g.
 *  "foo.bar(1, " -> "bar". Null when the cursor is not inside a call. */
export function callNameBeforeCursor(textBefore: string): string | null {
  let depth = 0;
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const c = textBefore[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const name = /([A-Za-z_$][\w$]*)\s*$/.exec(textBefore.slice(0, i));
        return name ? name[1] : null;
      }
      depth--;
    }
  }
  return null;
}

// Completion source factory

export function makeAtCompletionSource(varNames: string[], libraries: LibrarySource[] = []) {
  const libNames = libraries.map(l => l.name);
  const exportsByLib = new Map(libraries.map(l => [l.name, parseLibraryExports(l.code)] as const));
  // name -> "(params)" across all libraries, so the completion shows the call
  // signature next to each function.
  const sigByName: Record<string, string> = {};
  for (const lib of libraries) for (const [n, s] of Object.entries(parseLibrarySignatures(lib.code))) sigByName[n] ??= s;
  const memberOptions = (libName: string, q: string): Completion[] =>
    (exportsByLib.get(libName) ?? [])
      .filter(n => n.toLowerCase().includes(q.toLowerCase()))
      .map(n => ({ label: n, type: n in sigByName ? 'function' : 'variable', detail: sigByName[n], info: `Exported by '${libName}'` }));

  return function atSource(context: CompletionContext): CompletionResult | null {
    const line       = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // sp.require bindings across the whole script: namespace (var -> lib) and
    // the names pulled out by destructuring (so both can be completed later).
    const doc = context.state.doc.toString();
    const namespaceBindings = new Map<string, string>();
    const destructuredNames = new Set<string>();
    for (const m of doc.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*sp\.require\(\s*['"]([\w-]+)['"]\s*\)/g)) {
      namespaceBindings.set(m[1], m[2]);
    }
    for (const m of doc.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*sp\.require\(/g)) {
      for (const part of m[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const asM = /\bas\s+([A-Za-z_$][\w$]*)/.exec(seg);
        const name = asM ? asM[1] : seg.split(/[:\s]/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(name)) destructuredNames.add(name);
      }
    }

    // sp.require('name - complete the library name inside the quotes
    const reqNameMatch = /\bsp\.require\(\s*['"]([\w-]*)$/.exec(textBefore);
    if (reqNameMatch) {
      const q = reqNameMatch[1].toLowerCase();
      return {
        from: context.pos - reqNameMatch[1].length,
        options: libNames
          .filter(n => n.toLowerCase().includes(q))
          .map(n => ({ label: n, type: 'module', info: 'Reusable library (sp.require)', boost: 2 })),
        validFor: /^[\w-]*$/,
      };
    }

    // sp.require('name').member - complete exports directly off the require call
    const reqChainMatch = /\bsp\.require\(\s*['"]([\w-]+)['"]\)\.(\w*)$/.exec(textBefore);
    if (reqChainMatch) {
      return { from: context.pos - reqChainMatch[2].length, options: memberOptions(reqChainMatch[1], reqChainMatch[2]), validFor: /^\w*$/ };
    }

    // const { a, b| } = sp.require('name') - complete export names inside the braces
    // (works once the require part exists, e.g. when editing the destructure).
    const destructure = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*sp\.require\(\s*['"]([\w-]+)['"]\s*\)/.exec(line.text);
    if (destructure) {
      const braceOpen  = line.text.indexOf('{', destructure.index);
      const braceClose = line.text.indexOf('}', braceOpen);
      const posInLine  = context.pos - line.from;
      if (posInLine > braceOpen && posInLine <= braceClose) {
        const partial = (/([A-Za-z_$][\w$]*)?$/.exec(textBefore)?.[1]) ?? '';
        const already = new Set(destructure[1].split(',').map(s => s.trim().replace(/\s+as\s+.*/, '').split(/[:\s]/)[0]).filter(Boolean));
        const opts = (exportsByLib.get(destructure[2]) ?? [])
          .filter(n => n.toLowerCase().includes(partial.toLowerCase()) && (!already.has(n) || n === partial))
          .map(n => ({ label: n, type: n in sigByName ? 'function' : 'variable', detail: sigByName[n], info: `Exported by '${destructure[2]}'` }));
        if (opts.length) return { from: context.pos - partial.length, options: opts, validFor: /^\w*$/ };
      }
    }

    // <binding>.member where `const <binding> = sp.require('name')` appears anywhere
    const bindMatch = /\b([A-Za-z_$][\w$]*)\.(\w*)$/.exec(textBefore);
    if (bindMatch && bindMatch[1] !== 'sp' && bindMatch[1] !== 'faker') {
      const libName = namespaceBindings.get(bindMatch[1]);
      if (libName) {
        const opts = memberOptions(libName, bindMatch[2]);
        if (opts.length) return { from: context.pos - bindMatch[2].length, options: opts, validFor: /^\w*$/ };
      }
    }

    // {{varname}} - must be highest priority so it works inside strings too
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

    // sp.expect(...).to.be.xxx - chai assertion chain
    const chai = chaiChainCompletion(textBefore, context.pos);
    if (chai) return chai;

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
    const scopeMatch = /\bsp\.(variables|environment|collectionVariables|folder|globals)\.(\w*)$/.exec(textBefore);
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

    // dayjs(...).xxx and chained dayjs()....().xxx - a member access on a `)`
    // when a dayjs( call appears earlier on the line (dayjs objects chain).
    const dayjsDot = /\)\s*\.(\w*)$/.exec(textBefore);
    if (dayjsDot && /\bdayjs\s*\(/.test(textBefore)) {
      return { from: context.pos - dayjsDot[1].length, options: DAYJS_METHODS, validFor: /^\w*$/ };
    }

    // Unit argument inside a dayjs unit-taking method: complete 'day', 'hour', ...
    // inside the quotes, e.g. add(1, 'da | startOf('mon.
    const dayjsUnit = /\b(?:add|subtract|startOf|endOf|diff|get|set)\s*\([^()]*['"]([a-zA-Z]*)$/.exec(textBefore);
    if (dayjsUnit && /\bdayjs\s*\(/.test(textBefore)) {
      const q = dayjsUnit[1].toLowerCase();
      return {
        from: context.pos - dayjsUnit[1].length,
        options: DAYJS_UNITS.filter(o => o.label.toLowerCase().includes(q)),
        validFor: /^[a-zA-Z]*$/,
      };
    }

    // Top-level identifiers: sandbox globals (sp, faker, dayjs, ...) plus names
    // imported via sp.require. Drives Ctrl+Space and as-you-type suggestions in a
    // neutral position. Skipped after a dot (member access, handled above) and
    // inside strings / comments.
    {
      const word  = /([A-Za-z_$][\w$]*)$/.exec(textBefore);
      const start = word ? context.pos - word[1].length : context.pos;
      const prevInLine = start - line.from - 1;
      const prev  = prevInLine >= 0 ? line.text[prevInLine] : '';
      const node  = syntaxTree(context.state).resolveInner(context.pos, -1).name;
      const inStringOrComment = /String|Comment|TemplateString/.test(node);
      if ((context.explicit || word) && prev !== '.' && !inStringOrComment) {
        const q = (word?.[1] ?? '').toLowerCase();
        const bindingNames = [...new Set([...destructuredNames, ...namespaceBindings.keys()])];
        const importOpts: Completion[] = bindingNames.map(n => ({
          label: n, type: namespaceBindings.has(n) ? 'variable' : 'function',
          detail: sigByName[n], info: 'Imported with sp.require', boost: 1,
        }));
        const opts = [...importOpts, ...TOP_LEVEL_GLOBALS].filter(o => o.label.toLowerCase().includes(q));
        if (opts.length) return { from: start, options: opts, validFor: /^[\w$]*$/ };
      }
    }

    return null;
  };
}

/** CodeMirror extension: at.* API + {{varname}} + sp.require completions for script editors. */
export function atCompletionExtension(varNames: string[], libraries: LibrarySource[] = []) {
  return autocompletion({ override: [makeAtCompletionSource(varNames, libraries)] });
}

/** CodeMirror extension: a parameter-hint tooltip while the cursor is inside a
 *  call to a library function, e.g. `parseToken(` shows `parseToken(body)`. */
export function signatureHelpExtension(libraries: LibrarySource[] = []) {
  const libSigs: Record<string, string> = {};
  for (const lib of libraries) for (const [n, s] of Object.entries(parseLibrarySignatures(lib.code))) libSigs[n] ??= s;

  // The parameter hint for the call the cursor sits in. Library functions match
  // by name; dayjs methods match only when a dayjs(...) call precedes them on the
  // line, so an unrelated obj.add() / map.set() shows no misleading hint.
  const sigFor = (name: string, before: string): string | null => {
    if (name in libSigs) return libSigs[name];
    if (name in DAYJS_SIGS && /\bdayjs\s*\(/.test(before)) return DAYJS_SIGS[name];
    return null;
  };

  const field = StateField.define<readonly Tooltip[]>({
    create: () => [],
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      const sel = tr.state.selection.main;
      if (!sel.empty) return [];
      const line = tr.state.doc.lineAt(sel.head);
      const before = line.text.slice(0, sel.head - line.from);
      const name = callNameBeforeCursor(before);
      const sig = name ? sigFor(name, before) : null;
      if (!name || !sig) return [];
      return [{
        pos: sel.head,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.style.cssText = 'padding:3px 8px;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;';
          const nm = document.createElement('span'); nm.style.color = '#60a5fa'; nm.textContent = name;
          const pr = document.createElement('span'); pr.style.color = '#cbd5e1'; pr.textContent = sig;
          dom.append(nm, pr);
          return { dom };
        },
      }];
    },
    provide: f => showTooltip.computeN([f], state => state.field(f)),
  });
  return [field];
}

// Hover tooltip

/** CodeMirror extension: tooltip with the resolved value when hovering a {{varname}} token. */
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
              'display:flex;align-items:flex-start;gap:6px;padding:4px 10px;' +
              'font-size:11px;font-family:monospace;' +
              'max-width:min(32rem,90vw);max-height:60vh;overflow:auto;';

            const nameEl = document.createElement('span');
            nameEl.style.color = '#60a5fa';
            nameEl.style.cssText += 'flex:0 0 auto;white-space:nowrap;';
            nameEl.textContent = `{{${name}}}`;

            const arrow = document.createElement('span');
            arrow.style.color = '#6b7280';
            arrow.style.cssText += 'flex:0 0 auto;';
            arrow.textContent = '→';

            const valEl = document.createElement('span');
            // Long values wrap/break so the whole value stays readable; the
            // container scrolls for very large values.
            valEl.style.cssText = 'flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-all;';
            if (resolved !== undefined) {
              valEl.style.color = '#34d399';
              valEl.textContent = resolved;
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

        // {{faker.namespace.method( - show faker sub-methods
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

        // {{faker.namespace - show faker namespaces
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

        // {{dayjs - suggest dayjs expression starter
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

// Mock body completions

const REQUEST_SUB: Completion[] = [
  { label: 'params',  type: 'property', apply: 'params.',   info: 'URL path params (e.g. :id → request.params.id)' },
  { label: 'query',   type: 'property', apply: 'query.',    info: 'Query string params' },
  { label: 'body',    type: 'property', apply: 'body.',     info: 'Parsed request body fields (JSON)' },
  { label: 'bodyRaw', type: 'property', apply: 'bodyRaw}}', info: 'Raw request body as string' },
  { label: 'method',  type: 'property', apply: 'method}}',  info: 'HTTP method (GET, POST, …)' },
  { label: 'path',    type: 'property', apply: 'path}}',    info: 'Request URL path' },
  { label: 'headers', type: 'property', apply: 'headers.',  info: 'Request headers object' },
];

/** CodeMirror extension for mock response body editors ({{request.*}}, {{faker.*}}, {{dayjs()}}). */
export function mockBodyCompletionExtension(pathParamNames: string[] = [], varNames: string[] = []) {
  const allVarNames = [...DYNAMIC_VAR_NAMES, ...varNames];

  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line       = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);

        // {{request.params.xxx - suggest path param names
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

        // {{request.query.xxx / {{request.body.xxx / {{request.headers.xxx - generic key hints
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

        // {{request.xxx - suggest sub-properties
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

// Mock script completions

const RESPONSE_MEMBERS: Completion[] = [
  { label: 'statusCode', type: 'property', detail: 'number', info: 'HTTP status code to send' },
  { label: 'body',       type: 'property', detail: 'string', info: 'Response body string (overrides template)' },
  { label: 'headers',    type: 'property', detail: 'object', info: 'Response headers - modify with response.headers["X-Foo"] = "bar"' },
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

/** CodeMirror extension for mock pre-response script editors (request.*, response.*, faker.*, dayjs()). */
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

        // request.params.xxx / request.query.xxx etc - just hint at generic keys
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
