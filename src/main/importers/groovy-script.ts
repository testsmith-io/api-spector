// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Groovy to sp.* converter (SoapUI / ReadyAPI import). Regex/scan-based, not a full parser;
// tags anything it can't map with a `// TODO[soapui]` marker. Caveat: rewrites can touch keywords inside strings.

// Public API

export type GroovyConversionStatus = 'clean' | 'partial' | 'unsupported'

export interface GroovyUnmapped {
  /** 1-based line number in the converted output. */
  line: number
  /** The line's text (trimmed) that needs manual attention. */
  code: string
  /** Why it was flagged. */
  reason: string
}

export interface GroovyConversion {
  /** Best-effort JavaScript targeting the sp.* sandbox. */
  js: string
  /** clean = everything mapped; partial = mostly mapped, some review; */
  /** unsupported = little could be mapped automatically. */
  status: GroovyConversionStatus
  /** Human-readable notes about approximations the user should sanity-check. */
  notes: string[]
  /** Lines that could not be mapped and carry a TODO marker. */
  unmapped: GroovyUnmapped[]
}

type Rule = [RegExp, string]

// SoapUI property scope -> closest sp.* variable scope.
const SCOPE_MAP: Record<string, string> = {
  Project: 'collectionVariables',
  TestSuite: 'collectionVariables',
  TestCase: 'variables',
  Global: 'globals',
  Env: 'environment',
  Environment: 'environment',
};

// Whole-script rules, specific enough not to touch string contents.
const API_RULES: Rule[] = [
  // Logging -> captured console.*
  [/\blog\.info\s*\(/g, 'console.log('],
  [/\blog\.warn\s*\(/g, 'console.warn('],
  [/\blog\.error\s*\(/g, 'console.error('],
  [/\blog\.debug\s*\(/g, 'console.log('],

  // JSON - slurper/output/builder
  [/\bnew\s+groovy\.json\.JsonSlurper\s*\(\s*\)\s*\.parseText\s*\(/g, 'JSON.parse('],
  [/\bnew\s+JsonSlurper\s*\(\s*\)\s*\.parseText\s*\(/g, 'JSON.parse('],
  [/\bnew\s+groovy\.json\.JsonSlurper\s*\(\s*\)\s*\.parse\s*\(/g, 'JSON.parse('],
  [/\bnew\s+JsonSlurper\s*\(\s*\)\s*\.parse\s*\(/g, 'JSON.parse('],
  [/\bgroovy\.json\.JsonOutput\.toJson\s*\(/g, 'JSON.stringify('],
  [/\bJsonOutput\.toJson\s*\(/g, 'JSON.stringify('],

  // Current response body (Script Assertion context)
  [/\bmessageExchange\.response\.responseContent\b/g, 'sp.response.text()'],
  [/\bmessageExchange\.responseContent\b/g, 'sp.response.text()'],
  [/\bmessageExchange\.getResponseContent\s*\(\s*\)/g, 'sp.response.text()'],
  [/\bmessageExchange\.getResponseContentAsXml\s*\(\s*\)/g, 'sp.response.text()'],

  // Response headers
  [/\bmessageExchange\.responseHeaders\.get\s*\(/g, 'sp.response.headers.get('],
  [/\bmessageExchange\.getResponseHeaders\s*\(\s*\)\s*\.get\s*\(/g, 'sp.response.headers.get('],

  // Properties via context/testRunner
  [/\bcontext\.getProperty\s*\(/g, 'sp.variables.get('],
  [/\bcontext\.setProperty\s*\(/g, 'sp.variables.set('],
  [/\btestRunner\.testCase\.getPropertyValue\s*\(/g, 'sp.variables.get('],
  [/\btestRunner\.testCase\.setPropertyValue\s*\(/g, 'sp.variables.set('],

  // Common Groovy coercions with clean JS equivalents
  [/([\w.$)\]]+)\.toInteger\s*\(\s*\)/g, 'parseInt($1, 10)'],
  [/([\w.$)\]]+)\.toDouble\s*\(\s*\)/g, 'parseFloat($1)'],
  [/([\w.$)\]]+)\.toFloat\s*\(\s*\)/g, 'parseFloat($1)'],
];

// Language-level rules (whole-text; see header caveat).
const LANG_RULES: Rule[] = [
  // `def x` -> `let x` (declaration form only)
  [/\bdef\s+(?=[A-Za-z_$])/g, 'let '],
  // Groovy Elvis `a ?: b` -> `a || b`, both truthy-based
  [/\s*\?:\s*/g, ' || '],
  // `for (x in list)` -> `for (const x of list)`
  [/\bfor\s*\(\s*(?:def\s+)?([A-Za-z_$]\w*)\s+in\s+/g, 'for (const $1 of '],
];

// context.expand('${#Scope#name}') -> sp.<scope>.get('name')
// Only the *static token* form can be mapped; a dynamic expand() is flagged.
function convertContextExpand(src: string, notes: Set<string>, risky: Set<string>): string {
  return src.replace(
    /context\.expand\s*\(\s*(['"])\$\{#(\w+)#([\w.]+)\}\1\s*\)/g,
    (_m, _q, scope: string, name: string) => {
      const target = SCOPE_MAP[scope];
      if (!target) {
        risky.add(`context.expand scope "#${scope}#" has no sp.* equivalent; mapped to variables.`);
        return `sp.variables.get(${JSON.stringify(name)})`;
      }
      if (target !== 'variables') {
        risky.add(`Mapped SoapUI "#${scope}#" property to sp.${target} (closest equivalent).`);
      }
      return `sp.${target}.get(${JSON.stringify(name)})`;
    },
  );
}

// assert -> sp.expect
// `assert <expr>` and `assert <expr> : "<msg>"` become a truthy expectation.
function convertAsserts(src: string): string {
  return src.replace(/^([ \t]*)assert\s+(.+)$/gm, (_m, indent: string, rest: string) => {
    // Trailing `: message` (not a ternary): top-level ':' with no '?' before it.
    let expr = rest.trim();
    let msg = '';
    const colon = findAssertMessageColon(expr);
    if (colon >= 0) {
      msg = expr.slice(colon + 1).trim();
      expr = expr.slice(0, colon).trim();
    }
    const tail = msg ? `  // ${stripQuotes(msg)}` : '';
    return `${indent}sp.expect(${expr}).to.be.ok;${tail}`;
  });
}

// Index of the assert-message ':' (0 unmatched '?' before it), or -1.
function findAssertMessageColon(expr: string): number {
  let q = 0;
  let str: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '?') q++;
    else if (c === ':') { if (q === 0) return i; q--; }
  }
  return -1;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

// Regex match: `str ==~ /pat/` -> `/pat/.test(str)`
function convertRegexMatch(src: string, notes: Set<string>): string {
  let changed = false;
  const out = src.replace(/([\w.$)\]]+)\s*==~\s*\/((?:\\.|[^/\n])*)\//g, (_m, subject: string, pat: string) => {
    changed = true;
    return `/${pat}/.test(${subject})`;
  });
  if (changed) notes.add('Converted a Groovy `==~` regex match to RegExp.test().');
  return out;
}

// Closures on iteration methods -> arrow functions
const CLOSURE_METHODS: Record<string, string> = {
  each: 'forEach',
  eachWithIndex: 'forEach',
  collect: 'map',
  findAll: 'filter',
  find: 'find',
  any: 'some',
  every: 'every',
};

function convertClosures(src: string, notes: Set<string>, risky: Set<string>): string {
  const methodAlt = Object.keys(CLOSURE_METHODS).join('|');
  const opener = new RegExp(`\\.(${methodAlt})\\s*\\{`);
  let out = src;
  // Rewrite the first remaining closure each pass (outer-first), until none left.
  for (let guard = 0; guard < 1000; guard++) {
    const m = opener.exec(out);
    if (!m) break;
    const method = m[1];
    const braceIdx = m.index + m[0].length - 1;
    const close = findMatchingBrace(out, braceIdx);
    if (close < 0) {
      // Unbalanced nesting: stop touching closures, leave as-is.
      risky.add('A closure body could not be parsed and was left for manual review.');
      break;
    }
    const inner = out.slice(braceIdx + 1, close);
    const { params, body } = splitClosure(inner, method);
    const jsMethod = CLOSURE_METHODS[method];
    if ((method === 'collect' || method === 'findAll' || method === 'find'
      || method === 'any' || method === 'every') && /\n|;/.test(body.trim())) {
      risky.add(`Converted \`${method}\` to \`${jsMethod}\`; a multi-statement body may need an explicit \`return\`.`);
    }
    const arrow = buildArrow(params, body);
    out = out.slice(0, m.index) + `.${jsMethod}(${arrow})` + out.slice(close + 1);
  }
  return out;
}

// Split a closure interior into params + body; no arrow -> implicit params.
function splitClosure(inner: string, method: string): { params: string[]; body: string } {
  const arrowIdx = topLevelArrow(inner);
  if (arrowIdx >= 0) {
    const params = inner.slice(0, arrowIdx).split(',').map(p => p.trim()).filter(Boolean);
    return { params, body: inner.slice(arrowIdx + 2) };
  }
  const implicit = method === 'eachWithIndex' ? ['it', 'i'] : ['it'];
  return { params: implicit, body: inner };
}

function buildArrow(params: string[], body: string): string {
  const head = `(${params.join(', ')})`;
  const trimmed = body.trim();
  // Single expression -> expression-bodied arrow, keeping Groovy's implicit return.
  if (trimmed && !/[;\n]/.test(trimmed)) return `${head} => ${trimmed}`;
  return `${head} => {${body}}`;
}

// Index of a top-level `->` in a closure header, or -1 (skips strings).
function topLevelArrow(s: string): number {
  let str: string | null = null;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i];
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '{' || c === '}') return -1; // nested block before any arrow
    if (c === '-' && s[i + 1] === '>') return i;
  }
  return -1;
}

// Index of the `}` matching the `{` at `openIdx` (skips strings/comments), or -1.
function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (two === '//') { const e = src.indexOf('\n', i); i = e === -1 ? n : e; continue; }
    if (two === '/*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (three === '"""' || three === "'''") { const e = src.indexOf(three, i + 3); i = e === -1 ? n : e + 3; continue; }
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q || src[i] === '\n') break; i++; }
      i++; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// GString -> template literal (string segments only)
type Seg = { type: 'code' | 'str' | 'comment'; text: string }

function splitSegments(src: string): Seg[] {
  const segs: Seg[] = [];
  let code = '';
  const flush = () => { if (code) { segs.push({ type: 'code', text: code }); code = ''; } };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (two === '//') { flush(); const e = src.indexOf('\n', i); const end = e === -1 ? n : e; segs.push({ type: 'comment', text: src.slice(i, end) }); i = end; continue; }
    if (two === '/*') { flush(); const e = src.indexOf('*/', i + 2); const end = e === -1 ? n : e + 2; segs.push({ type: 'comment', text: src.slice(i, end) }); i = end; continue; }
    if (three === '"""' || three === "'''") { flush(); const e = src.indexOf(three, i + 3); const end = e === -1 ? n : e + 3; segs.push({ type: 'str', text: src.slice(i, end) }); i = end; continue; }
    const c = src[i];
    if (c === '"' || c === "'") {
      flush();
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) { j++; break; } if (src[j] === '\n') break; j++; }
      segs.push({ type: 'str', text: src.slice(i, j) });
      i = j; continue;
    }
    code += c; i++;
  }
  flush();
  return segs;
}

// Groovy string literal -> JS: double/triple-double with interpolation become
// template literals; single-quoted stay literal.
function convertStringLiteral(lit: string, notes: Set<string>): string {
  if (lit.startsWith('"""')) {
    const body = lit.slice(3, lit.endsWith('"""') ? lit.length - 3 : lit.length);
    return '`' + interpolate(escapeBackticks(body)) + '`';
  }
  if (lit.startsWith("'''")) {
    const body = lit.slice(3, lit.endsWith("'''") ? lit.length - 3 : lit.length);
    return '`' + escapeTemplate(body) + '`';
  }
  if (lit.startsWith('"')) {
    const body = lit.slice(1, lit.endsWith('"') && lit.length > 1 ? lit.length - 1 : lit.length);
    if (/\$\{|\$[A-Za-z_]/.test(body)) {
      notes.add('Converted a double-quoted GString to a JS template literal.');
      return '`' + interpolate(escapeBackticks(body)) + '`';
    }
    return '"' + body + '"';
  }
  // single-quoted: literal in Groovy, leave untouched
  return lit;
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}

// Literal template body: neutralise backticks AND `${` so nothing interpolates.
function escapeTemplate(s: string): string {
  return s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Groovy `$ident` / `$ident.prop` -> `${ident}`; existing `${...}` untouched.
function interpolate(s: string): string {
  return s.replace(/\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g, '${$1}');
}

// Unsupported-construct detection (post-conversion line scan)
interface Detector { re: RegExp; reason: string; note?: boolean }

const DETECTORS: Detector[] = [
  { re: /\bnew\s+XmlSlurper\b|\bnew\s+XmlParser\b|\bXmlHolder\b/, reason: 'XML parsing (XmlSlurper/XmlHolder) has no direct sp.* equivalent; use sp.response.xmlText(selector) or parse manually.' },
  { re: /\btestRunner\b/, reason: 'testRunner / test-model navigation is not available in the sp.* sandbox.' },
  { re: /\btestSuite\b|\bmockService\b/, reason: 'SoapUI test-model object is not available in the sp.* sandbox.' },
  { re: /\bcontext\.expand\s*\(/, reason: 'Dynamic context.expand(...) cannot be mapped automatically; replace with the concrete sp.* variable.' },
  { re: /\bThread\s*\.\s*sleep\b|(?<![\w.])sleep\s*\(/, reason: 'Blocking sleep is not available (the sandbox is synchronous).' },
  { re: /\.\s*times\s*\{|\.\s*with\s*\{|\.\s*eachLine\b/, reason: 'This Groovy idiom is not auto-converted; rewrite as a loop.' },
  { re: /[^=!<>~]=~[^~]/, reason: 'Groovy matcher (=~) is not supported; use RegExp directly.' },
  { re: /\bnew\s+(?!RegExp\b|Error\b|Date\b|Map\b|Set\b|Array\b|Object\b|Promise\b|Number\b|String\b|Boolean\b|WeakMap\b|WeakSet\b)[A-Z]\w*/, reason: 'Constructs a Java/Groovy object with no JS equivalent; needs manual conversion.' },
  { re: /\bas\s+[A-Z]\w+/, reason: 'Groovy `as` cast has no JS equivalent; it can usually be removed.', note: true },
];

// Remove string/comment spans from a line so detectors do not fire on content.
function stripForScan(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// Orchestrator

export function convertGroovyScript(source: string): GroovyConversion {
  // `notes` are informational; `risky` approximations (or unmapped lines)
  // downgrade a converted script from `clean` to `partial`.
  const notes = new Set<string>();
  const risky = new Set<string>();
  let src = source.replace(/\r\n/g, '\n');

  // 1. Drop Groovy imports (their usages are remapped below / flagged).
  src = src.replace(/^[ \t]*import\s+[^\n]*$/gm, (m) => {
    notes.add('Removed Groovy import statements.');
    return `// (removed) ${m.trim()}`;
  });

  // 2. Paren-free println / print / log.* -> console.*
  src = src.replace(/^([ \t]*)println\s+(?!\()(.+)$/gm, '$1console.log($2)');
  src = src.replace(/^([ \t]*)print\s+(?!\()(.+)$/gm, '$1console.log($2)');
  src = src.replace(/\bprintln\s*\(/g, 'console.log(');
  src = src.replace(/^([ \t]*)log\.(?:info|debug)\s+(?!\()(.+)$/gm, '$1console.log($2)');
  src = src.replace(/^([ \t]*)log\.warn\s+(?!\()(.+)$/gm, '$1console.warn($2)');
  src = src.replace(/^([ \t]*)log\.error\s+(?!\()(.+)$/gm, '$1console.error($2)');

  // 3. Specific API + context.expand + assert + regex-match.
  src = convertContextExpand(src, notes, risky);
  for (const [re, rep] of API_RULES) src = src.replace(re, rep);
  src = convertRegexMatch(src, notes);
  src = convertAsserts(src);

  // 4. Closures on iteration methods (brace-matched).
  src = convertClosures(src, notes, risky);

  // 5. Language-level rewrites (def/Elvis/for-in).
  const hadElvis = /\?:/.test(src);
  for (const [re, rep] of LANG_RULES) src = src.replace(re, rep);
  if (hadElvis) risky.add('Groovy Elvis `?:` was mapped to `||` (both are truthy-based; verify for 0/"" values).');

  // 6. GString -> template literal (string segments only).
  src = splitSegments(src)
    .map(seg => (seg.type === 'str' ? convertStringLiteral(seg.text, notes) : seg.text))
    .join('');

  // 7. Flag anything still unsupported, line by line.
  const lines = src.split('\n');
  const unmapped: GroovyUnmapped[] = [];
  for (let i = 0; i < lines.length; i++) {
    const scan = stripForScan(lines[i]);
    if (!scan.trim() || scan.trim().startsWith('//')) continue;
    for (const d of DETECTORS) {
      if (!d.re.test(scan)) continue;
      if (d.note) { notes.add(d.reason); continue; }
      if (!lines[i].includes('TODO[soapui]')) lines[i] = `${lines[i]}  // TODO[soapui]: ${d.reason}`;
      unmapped.push({ line: i + 1, code: lines[i].replace(/\s*\/\/ TODO\[soapui\].*$/, '').trim(), reason: d.reason });
      break; // one marker per line
    }
  }
  const js = lines.join('\n');

  // 8. Classify: routine conversions stay `clean`; risky/unmapped need review.
  const meaningful = lines.filter(l => { const t = stripForScan(l).trim(); return t && !t.startsWith('//'); }).length || 1;
  let status: GroovyConversionStatus;
  if (unmapped.length === 0) status = risky.size === 0 ? 'clean' : 'partial';
  else if (unmapped.length <= Math.ceil(meaningful * 0.34)) status = 'partial';
  else status = 'unsupported';

  return { js, status, notes: [...new Set([...risky, ...notes])], unmapped };
}
