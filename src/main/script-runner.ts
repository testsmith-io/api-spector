// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import * as vm from 'node:vm';
import * as crypto from 'node:crypto';
import dayjs from 'dayjs';
import tv4 from 'tv4';
import { JSONPath } from 'jsonpath-plus';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';

// querySelector polyfill for xmldom. Handles the limited selector syntax the tree
// view emits: "tag", "tag:nth-of-type(n) > child > grandchild", etc.

type XmlNode = { childNodes: ArrayLike<XmlNode>; nodeType: number; tagName?: string; [k: string]: unknown }

// Collect all elements with `tag` that are the nth-of-type among their siblings,
// anywhere in the subtree of `node`.
function xmlFindAll(node: XmlNode, tag: string, nth: number): XmlNode[] {
  const results: XmlNode[] = [];
  const siblings = Array.from(node.childNodes).filter(c => c.nodeType === 1 && c.tagName === tag);
  if (siblings[nth]) results.push(siblings[nth]);
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1) results.push(...xmlFindAll(child, tag, nth));
  }
  return results;
}

function xmlQuerySelector(root: XmlNode, selector: string): XmlNode | null {
  const parts = selector.trim().split(/\s*>\s*/);

  // First part: search entire subtree
  const m0 = /^([A-Za-z0-9_:.-]+?)(?::nth-of-type\((\d+)\))?$/.exec(parts[0]);
  if (!m0) return null;
  let candidates = xmlFindAll(root, m0[1], m0[2] ? Number.parseInt(m0[2]) - 1 : 0);

  // Remaining parts: direct-child traversal
  for (let i = 1; i < parts.length; i++) {
    const m = /^([A-Za-z0-9_:.-]+?)(?::nth-of-type\((\d+)\))?$/.exec(parts[i]);
    if (!m) return null;
    const tag = m[1];
    const idx = m[2] ? Number.parseInt(m[2]) - 1 : 0;
    const next: XmlNode[] = [];
    for (const node of candidates) {
      const children = Array.from(node.childNodes).filter(c => c.nodeType === 1 && c.tagName === tag);
      if (children[idx]) next.push(children[idx]);
    }
    candidates = next;
  }

  return candidates[0] ?? null;
}

function makeSandboxDOMParser() {
  return {
    parseFromString(str: string, mime: string) {
      const doc = new XmlDOMParser().parseFromString(str, mime as 'text/xml') as unknown as XmlNode & { querySelector: (s: string) => XmlNode | null };
      doc.querySelector = (sel: string) => xmlQuerySelector(doc, sel);
      return doc;
    },
  };
}
import type { TestResult, ResponsePayload } from '../shared/types';
import type { ScriptLibrary } from '../shared/libraries';
import { transpileScript, buildRequire, makeExternalRequire } from './script-modules';
import type { faker as FakerType } from '@faker-js/faker';

// @faker-js/faker v10 is ESM-only - must use dynamic import
let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  _fakerCache ??= await import('@faker-js/faker');
  return _fakerCache.faker;
}

// Public types

export interface ScriptContext {
  envVars: Record<string, string>
  collectionVars: Record<string, string>
  globals: Record<string, string>
  localVars: Record<string, string>
  /** Variables scoped to the request's folder chain (innermost wins). Exposed
   *  as `sp.folder` and persisted back to the innermost folder. */
  folderVars?: Record<string, string>
  response?: ResponsePayload
  /** Case-insensitive substring patterns on variable names; matched values are
   *  redacted in `[set]` console lines so post-script secrets don't leak into reports. */
  piiMaskPatterns?: string[]
  /** Rich data channel for flows (loop items, evaluate outputs), exposed as the
   *  global `data` and `sp.data`. */
  data?: Record<string, unknown>
  /** Messages collected during an MQTT test, exposed as `sp.messages`. Each
   *  gains `.json()` / `.text()` helpers in the sandbox. */
  mqttMessages?: { topic: string; payload: string; qos?: number; retain?: boolean; timestamp: number }[]
  /** Messages from a realtime test (WebSocket/Socket.IO/GraphQL), exposed as `sp.messages`.
   *  Each needs a `payload` string (behind .json()/.text()); other fields pass through.
   *  Takes precedence over `mqttMessages`. */
  messages?: ({ payload: string; timestamp: number } & Record<string, unknown>)[]
  /** Reusable TypeScript library files in scope for this run (workspace +
   *  collection + folder chain, already merged innermost-wins). Reachable from
   *  the script via `sp.require('<name>')`. */
  libraries?: ScriptLibrary[]
  /** Workspace directory. When set, sp.require() can also load CommonJS npm
   *  packages from `<libraryRoot>/node_modules`. */
  libraryRoot?: string
  /** Transport for sp.sendRequest(). Injected by the caller (it owns the
   *  dispatcher / proxy / TLS); absent in contexts without an HTTP layer
   *  (flow logic blocks, realtime tests), where sp.sendRequest throws. */
  sendRequest?: (req: ScriptHttpRequest) => Promise<ScriptHttpResponse>
}

/** Normalized request handed to the sp.sendRequest transport. */
export interface ScriptHttpRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** Raw response the transport returns; sp.sendRequest wraps it for the script. */
export interface ScriptHttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  responseTime: number
}

export interface ScriptOutput {
  testResults: TestResult[]
  consoleOutput: string[]
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
  updatedFolderVars: Record<string, string>
  error?: string
}

// Chainable Asserter

interface Asserter {
  // Chainers (no-op, return self)
  to: Asserter; be: Asserter; been: Asserter; have: Asserter
  that: Asserter; and: Asserter; is: Asserter; deep: Asserter
  // Negation
  not: Asserter
  // Flag assertions (getter-style, still callable as property)
  ok: Asserter; true: Asserter; false: Asserter; null: Asserter; undefined: Asserter
  // Method assertions
  equal(expected: unknown): Asserter
  eq(expected: unknown): Asserter
  eql(expected: unknown): Asserter
  include(substr: unknown): Asserter
  contain(substr: unknown): Asserter
  property(name: string, expected?: unknown): Asserter
  a(type: string): Asserter
  above(n: number): Asserter; gt(n: number): Asserter
  below(n: number): Asserter; lt(n: number): Asserter
  least(n: number): Asserter; gte(n: number): Asserter
  most(n: number): Asserter;  lte(n: number): Asserter
  oneOf(list: unknown[]): Asserter
  lengthOf(n: number): Asserter
  match(re: RegExp): Asserter
}

function makeAsserter(value: unknown, negated = false): Asserter {
  function doAssert(condition: boolean, msg: string): void {
    const passed = negated ? !condition : condition;
    if (!passed) throw new AssertionError(msg);
  }

  const asserter = {} as Asserter;

  // Chainers
  const chainer = { get: () => asserter };
  for (const key of ['to','be','been','have','that','and','is','deep'] as const) {
    Object.defineProperty(asserter, key, chainer);
  }

  // Negation
  Object.defineProperty(asserter, 'not', { get: () => makeAsserter(value, !negated) });

  // Boolean flag assertions
  Object.defineProperty(asserter, 'ok', { get: () => {
    doAssert(Boolean(value), `Expected ${JSON.stringify(value)} to be truthy`);
    return asserter;
  }});
  Object.defineProperty(asserter, 'true', { get: () => {
    doAssert(value === true, `Expected ${JSON.stringify(value)} to be true`);
    return asserter;
  }});
  Object.defineProperty(asserter, 'false', { get: () => {
    doAssert(value === false, `Expected ${JSON.stringify(value)} to be false`);
    return asserter;
  }});
  Object.defineProperty(asserter, 'null', { get: () => {
    doAssert(value === null, `Expected ${JSON.stringify(value)} to be null`);
    return asserter;
  }});
  Object.defineProperty(asserter, 'undefined', { get: () => {
    doAssert(value === undefined, `Expected value to be undefined`);
    return asserter;
  }});

  // Method assertions
  asserter.equal = (expected) => {
    doAssert(value === expected,
      `Expected ${JSON.stringify(value)} to ${negated ? 'not ' : ''}equal ${JSON.stringify(expected)}`);
    return asserter;
  };
  asserter.eq = asserter.equal;  // Chai alias
  asserter.eql = (expected) => {
    doAssert(JSON.stringify(value) === JSON.stringify(expected),
      `Expected deep equal: ${JSON.stringify(value)} ${negated ? '!=' : '=='} ${JSON.stringify(expected)}`);
    return asserter;
  };
  asserter.include = (substr) => {
    if (typeof value === 'string') {
      doAssert(value.includes(String(substr)),
        `Expected "${value}" to ${negated ? 'not ' : ''}include "${substr}"`);
    } else if (Array.isArray(value)) {
      doAssert(value.includes(substr),
        `Expected array to ${negated ? 'not ' : ''}include ${JSON.stringify(substr)}`);
    }
    return asserter;
  };
  asserter.contain = asserter.include;  // Chai alias
  asserter.property = (name, expected?) => {
    doAssert(value != null && name in Object(value),
      `Expected object to ${negated ? 'not ' : ''}have property "${name}"`);
    if (expected !== undefined) {
      doAssert((value as Record<string, unknown>)[name] === expected,
        `Expected property "${name}" to equal ${JSON.stringify(expected)}`);
    }
    return asserter;
  };
  asserter.a = (type) => {
    const actual = Array.isArray(value) ? 'array' : typeof value;
    doAssert(actual === type,
      `Expected ${JSON.stringify(value)} to ${negated ? 'not ' : ''}be a ${type}`);
    return asserter;
  };
  asserter.above = (n) => {
    doAssert((value as number) > n, `Expected ${value} to ${negated ? 'not ' : ''}be above ${n}`);
    return asserter;
  };
  asserter.below = (n) => {
    doAssert((value as number) < n, `Expected ${value} to ${negated ? 'not ' : ''}be below ${n}`);
    return asserter;
  };
  asserter.least = (n) => {
    doAssert((value as number) >= n, `Expected ${value} to ${negated ? 'not ' : ''}be at least ${n}`);
    return asserter;
  };
  asserter.most = (n) => {
    doAssert((value as number) <= n, `Expected ${value} to ${negated ? 'not ' : ''}be at most ${n}`);
    return asserter;
  };
  asserter.gt = asserter.above; asserter.gte = asserter.least;
  asserter.lt = asserter.below; asserter.lte = asserter.most;

  asserter.oneOf = (list) => {
    doAssert(list.includes(value),
      `Expected ${JSON.stringify(value)} to ${negated ? 'not ' : ''}be one of ${JSON.stringify(list)}`);
    return asserter;
  };
  asserter.lengthOf = (n) => {
    const len = (value as { length: number }).length;
    doAssert(len === n,
      `Expected length ${len} to ${negated ? 'not ' : ''}equal ${n}`);
    return asserter;
  };
  asserter.match = (re) => {
    doAssert(re.test(String(value)),
      `Expected "${value}" to ${negated ? 'not ' : ''}match ${re}`);
    return asserter;
  };

  return asserter;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

// sp.sendRequest input normalization (Postman-compatible)

/** Accepts a url string or a request object and produces the transport's shape.
 *  Postman shapes supported: `{ url, method, header, body }` where header is an
 *  object or a [{key,value}] list, and body is a string or a mode object
 *  (raw / urlencoded / formdata / graphql). */
function normalizeSendHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (Array.isArray(h)) {
    for (const item of h) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec.key === 'string' && rec.disabled !== true) {
          out[rec.key] = rec.value == null ? '' : String(rec.value);
        }
      }
    }
  } else if (typeof h === 'object') {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k] = v == null ? '' : String(v);
  }
  return out;
}

function normalizeSendBody(b: unknown, headers: Record<string, string>): string | undefined {
  if (b == null) return undefined;
  if (typeof b === 'string') return b;
  if (typeof b !== 'object') return String(b);
  const o = b as Record<string, unknown>;
  const mode = typeof o.mode === 'string' ? o.mode : undefined;
  const hasCT = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');

  if (mode === 'raw' || (!mode && typeof o.raw === 'string')) {
    return typeof o.raw === 'string' ? o.raw : undefined;
  }
  if (mode === 'urlencoded' || mode === 'formdata') {
    const list = mode === 'urlencoded' ? o.urlencoded : o.formdata;
    const encoded = (Array.isArray(list) ? list : [])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).key === 'string' && (p as Record<string, unknown>).disabled !== true)
      .map(p => `${encodeURIComponent(String(p.key))}=${encodeURIComponent(p.value == null ? '' : String(p.value))}`)
      .join('&');
    if (!hasCT) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return encoded;
  }
  if (mode === 'graphql' && o.graphql && typeof o.graphql === 'object') {
    const g = o.graphql as Record<string, unknown>;
    const payload: Record<string, unknown> = { query: g.query };
    if (g.variables !== undefined) payload.variables = g.variables;
    if (!hasCT) headers['Content-Type'] = 'application/json';
    return JSON.stringify(payload);
  }
  // Fallback: a plain object is sent as JSON.
  if (!hasCT) headers['Content-Type'] = 'application/json';
  return JSON.stringify(o);
}

function normalizeSendInput(input: unknown): ScriptHttpRequest {
  if (typeof input === 'string') return { url: input, method: 'GET', headers: {} };
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : o.url != null ? String(o.url) : '';
    if (!url) throw new Error('sp.sendRequest: a url is required');
    const method = typeof o.method === 'string' && o.method.trim() ? o.method.toUpperCase() : 'GET';
    const headers = normalizeSendHeaders(o.header ?? o.headers);
    const body = normalizeSendBody(o.body, headers);
    return { url, method, headers, body };
  }
  throw new Error('sp.sendRequest: expected a url string or a request object');
}

/** Wraps the transport's raw response in a Postman-style response object:
 *  `.code`, `.status`, `.responseTime`, `.headers.get()`, `.json()`, `.text()`. */
function makeSendResponse(raw: ScriptHttpResponse) {
  let parsed: unknown;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.headers)) lower[k.toLowerCase()] = v;
  return {
    code: raw.status,
    status: raw.statusText,
    responseTime: raw.responseTime,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] ?? null,
      toObject: () => ({ ...raw.headers }),
    },
    json: () => { if (parsed === undefined) parsed = JSON.parse(raw.body); return parsed; },
    text: () => raw.body,
  };
}

// Build sp object

function buildAt(
  ctx: ScriptContext,
  testResults: TestResult[],
  consoleOutput: string[],
) {
  const { envVars, collectionVars, globals, localVars, piiMaskPatterns = [] } = ctx;
  const folderVars = ctx.folderVars ?? {};

  const isSensitiveKey = (key: string) =>
    piiMaskPatterns.some(p => key.toLowerCase().includes(p.toLowerCase()));

  function makeVarScope(store: Record<string, string>, scopeName: string) {
    return {
      get: (key: string) => store[key] ?? null,
      set: (key: string, value: string) => {
        store[key] = String(value);
        const display = isSensitiveKey(key) ? '"[REDACTED]"' : JSON.stringify(String(value));
        consoleOutput.push(`[set] ${scopeName}.${key} = ${display}`);
      },
      clear: (key: string) => {
        delete store[key];
        consoleOutput.push(`[set] ${scopeName}.${key} cleared`);
      },
      has: (key: string) => key in store,
      toObject: () => ({ ...store }),
    };
  }

  const sp: Record<string, unknown> = {
    // Variable scopes
    variables:           makeVarScope(localVars,      'variables'),
    // Request-scoped set/get. Request vars share the local store at run time: they
    // apply for the current run but are never written back to the saved collection.
    request:             makeVarScope(localVars,      'request'),
    environment:         makeVarScope(envVars,         'environment'),
    collectionVariables: makeVarScope(collectionVars,  'collectionVariables'),
    folder:              makeVarScope(folderVars,       'folder'),
    globals:             makeVarScope(globals,          'globals'),

    // Convenience: get/set across all scopes (local wins)
    variables_get: (key: string) =>
      localVars[key] ?? envVars[key] ?? folderVars[key] ?? collectionVars[key] ?? globals[key] ?? null,
    variables_set: (key: string, value: string) => { localVars[key] = String(value); },

    // Test runner
    test: (name: string, fn: () => void) => {
      try {
        fn();
        testResults.push({ name, passed: true });
      } catch (err) {
        const line = scriptLineOf(err);
        testResults.push({
          name,
          passed: false,
          error: (err instanceof Error ? err.message : String(err)) + (line ? ` (line ${line})` : ''),
        });
      }
    },

    // Expect / assertions
    expect: (value: unknown) => makeAsserter(value, false),

    // JSONPath query: sp.jsonPath(data, '$.store.book[?(@.price < 10)].title')
    jsonPath: (data: unknown, expr: string) =>
      JSONPath({ path: expr, json: data as object }),

    /** TOTP code from a base32 secret. Options: digits (6), period secs (30),
     *  algorithm "sha1"|"sha256"|"sha512" ("sha1"). */
    totp: (secret: string, options?: { digits?: number; period?: number; algorithm?: string }) => {
      const digits    = options?.digits ?? 6;
      const period    = options?.period ?? 30;
      const algorithm = options?.algorithm ?? 'sha1';

      // Decode base32 secret
      const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const cleaned = secret.replaceAll(/[\s=-]/g, '').toUpperCase();
      let bits = '';
      for (const c of cleaned) {
        const val = base32chars.indexOf(c);
        if (val < 0) throw new Error(`Invalid base32 character: ${c}`);
        bits += val.toString(2).padStart(5, '0');
      }
      const keyBytes = Buffer.alloc(Math.floor(bits.length / 8));
      for (let i = 0; i < keyBytes.length; i++) {
        keyBytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
      }

      // Compute HMAC over the time counter
      const counter = Math.floor(Date.now() / 1000 / period);
      const counterBuf = Buffer.alloc(8);
      counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
      counterBuf.writeUInt32BE(counter >>> 0, 4);

      const hmac = crypto.createHmac(algorithm, keyBytes).update(counterBuf).digest();

      // Dynamic truncation (RFC 4226)
      const offset = hmac[hmac.length - 1] & 0x0f;
      const binCode =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

      return String(binCode % 10 ** digits).padStart(digits, '0');
    },

    /** Send an HTTP request from a script. Postman-compatible:
     *    const res = await sp.sendRequest('https://...')
     *    sp.sendRequest({ url, method, header, body }, (err, res) => { ... })
     *  Returns a promise resolving to a response with .code/.status/.json()/
     *  .text()/.headers.get()/.responseTime. Needs a transport (ctx.sendRequest);
     *  unavailable in flow logic blocks and realtime tests. */
    sendRequest: (input: unknown, callback?: (err: Error | null, res?: unknown) => void): Promise<unknown> => {
      const run = async (): Promise<unknown> => {
        if (!ctx.sendRequest) throw new Error('sp.sendRequest is not available in this context');
        const normalized = normalizeSendInput(input);
        consoleOutput.push(`[sendRequest] ${normalized.method} ${normalized.url}`);
        const raw = await ctx.sendRequest(normalized);
        return makeSendResponse(raw);
      };
      const promise = run();
      // Guard against a process-level unhandled rejection when the caller neither
      // awaits the result nor passes a callback. Awaiting the returned promise
      // still surfaces the error normally.
      promise.catch(() => {});
      if (typeof callback === 'function') {
        promise.then(
          res => callback(null, res),
          err => callback(err instanceof Error ? err : new Error(String(err))),
        );
        // Swallow rejection on the returned promise: the callback already owns
        // the error, so awaiting it as well must not double-report / reject.
        return promise.catch(() => undefined);
      }
      return promise;
    },
  };

  // Realtime test messages exposed as sp.messages with per-message .json()/.text().
  // The generic `messages` channel wins; `mqttMessages` is the original MQTT shape.
  const collected = ctx.messages ?? ctx.mqttMessages;
  if (collected) {
    sp.messages = collected.map(m => ({
      ...m,
      json: () => JSON.parse(m.payload),
      text: () => m.payload,
    }));
  }

  // Attach response helpers if available
  if (ctx.response) {
    const resp = ctx.response;
    let parsedJson: unknown = undefined;

    sp.response = {
      code: resp.status,
      status: `${resp.status} ${resp.statusText}`,
      statusText: resp.statusText,
      responseTime: resp.durationMs,
      responseSize: resp.bodySize,
      headers: {
        get: (name: string) => resp.headers[name.toLowerCase()] ?? null,
        toObject: () => resp.headers,
      },
      json: () => {
        if (parsedJson === undefined) parsedJson = JSON.parse(resp.body);
        return parsedJson;
      },
      text: () => resp.body,
      xmlText: (selector: string) => {
        const doc = new XmlDOMParser().parseFromString(resp.body, 'text/xml') as unknown as XmlNode;
        const node = xmlQuerySelector(doc, selector);
        return node ? String(node.textContent ?? '').trim() : null;
      },
      to: {
        have: {
          status: (code: number) => {
            if (resp.status !== code) throw new AssertionError(`Expected status ${resp.status} to be ${code}`);
          },
        },
      },
    };
  }

  return sp;
}

// Sandbox

/** vm sandbox shared by runScript and evaluateExpression. scriptCtx's variable scopes
 *  are mutated in place by sp.*; `data` passes by reference for flow blocks. */
function buildSandbox(
  scriptCtx: ScriptContext,
  testResults: TestResult[],
  consoleOutput: string[],
  faker: typeof FakerType,
  timeoutMs = 5000,
): Record<string, unknown> {
  const sp = buildAt(scriptCtx, testResults, consoleOutput);
  const captureConsole = {
    log:   (...args: unknown[]) => consoleOutput.push(args.map(String).join(' ')),
    warn:  (...args: unknown[]) => consoleOutput.push('[warn] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => consoleOutput.push('[error] ' + args.map(String).join(' ')),
    info:  (...args: unknown[]) => consoleOutput.push('[info] ' + args.map(String).join(' ')),
  };
  const sandbox: Record<string, unknown> = {
    sp,
    data: scriptCtx.data ?? {},
    DOMParser: makeSandboxDOMParser,
    dayjs,
    faker,
    tv4,
    console: captureConsole,
    JSON,
    Math,
    Date,
    parseInt: Number.parseInt,
    parseFloat: Number.parseFloat,
    // isNaN/isFinite intentionally expose the global (coercing) semantics user scripts expect
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: undefined,  // not available in sync vm context
    setInterval: undefined,
  };
  // sp.require('<name>') resolves a scoped library; libraries share these same
  // globals and are evaluated lazily on first require. An external resolver lets
  // it fall back to CommonJS npm packages in the workspace's node_modules.
  sp.require = buildRequire(scriptCtx.libraries, sandbox, timeoutMs, makeExternalRequire(scriptCtx.libraryRoot));
  return sandbox;
}

// Main entry point

// User-script line number from an error thrown in the vm. Scripts run unwrapped as
// 'script.js', so stack frames map 1:1 to the lines the user typed.
function scriptLineOf(err: unknown): number | undefined {
  if (err instanceof Error && err.stack) {
    const m = err.stack.match(/script\.js:(\d+):\d+/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export async function runScript(
  code: string,
  ctx: ScriptContext,
  timeoutMs = 5000,
): Promise<ScriptOutput> {
  const faker = await getFaker();
  const testResults: TestResult[] = [];
  const consoleOutput: string[] = [];

  // Mutable copies that pm modifies in-place
  const envVarsCopy      = { ...ctx.envVars };
  const collectionCopy   = { ...ctx.collectionVars };
  const globalsCopy      = { ...ctx.globals };
  const localVarsCopy    = { ...ctx.localVars };
  const folderCopy       = { ...(ctx.folderVars ?? {}) };

  const scriptCtx: ScriptContext = {
    envVars:        envVarsCopy,
    collectionVars: collectionCopy,
    globals:        globalsCopy,
    localVars:      localVarsCopy,
    folderVars:     folderCopy,
    response:       ctx.response,
    data:           ctx.data,
    mqttMessages:   ctx.mqttMessages,
    messages:       ctx.messages,
    piiMaskPatterns: ctx.piiMaskPatterns,
    libraries:      ctx.libraries,
    libraryRoot:    ctx.libraryRoot,
    sendRequest:    ctx.sendRequest,
  };

  const sandbox = buildSandbox(scriptCtx, testResults, consoleOutput, faker, timeoutMs);

  // Strip TypeScript types before running. Keeps lines 1:1 so `script.js:LINE`
  // still points at the user's source; a type/syntax error surfaces as an error.
  let runnable: string;
  try {
    runnable = transpileScript(code);
  } catch (err) {
    const line = scriptLineOf(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      testResults,
      consoleOutput,
      updatedEnvVars:        envVarsCopy,
      updatedCollectionVars: collectionCopy,
      updatedGlobals:        globalsCopy,
      updatedLocalVars:      localVarsCopy,
      updatedFolderVars:     folderCopy,
      error: (line ? `Line ${line}: ` : '') + message,
    };
  }

  try {
    // Wrap in an async IIFE so scripts may `await` (e.g. sp.sendRequest). The
    // opening token stays on the body's first physical line, so a thrown error's
    // `script.js:LINE` still maps 1:1 to the user's source. The vm timeout bounds
    // the synchronous portion; the awaited promise is bounded by the transport.
    const completion = vm.runInNewContext(`(async () => {${runnable}\n})()`, sandbox, { timeout: timeoutMs, filename: 'script.js' });
    await completion;
  } catch (err) {
    const line = scriptLineOf(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      testResults,
      consoleOutput,
      updatedEnvVars:        envVarsCopy,
      updatedCollectionVars: collectionCopy,
      updatedGlobals:        globalsCopy,
      updatedLocalVars:      localVarsCopy,
      updatedFolderVars:     folderCopy,
      error: (line ? `Line ${line}: ` : '') + message,
    };
  }

  return {
    testResults,
    consoleOutput,
    updatedEnvVars:        envVarsCopy,
    updatedCollectionVars: collectionCopy,
    updatedGlobals:        globalsCopy,
    updatedLocalVars:      localVarsCopy,
    updatedFolderVars:     folderCopy,
  };
}

export interface ExpressionOutput {
  /** Completion value of the evaluated expression (vm returns the last value). */
  value: unknown
  consoleOutput: string[]
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
  error?: string
}

/** Evaluate a JS expression in the runScript sandbox and return its completion value.
 *  Used by flow logic blocks (if/condition, forEach). Side effects are honored and
 *  the updated scopes returned. */
export async function evaluateExpression(
  code: string,
  ctx: ScriptContext,
  timeoutMs = 5000,
): Promise<ExpressionOutput> {
  const faker = await getFaker();
  const testResults: TestResult[] = [];
  const consoleOutput: string[] = [];

  const envVarsCopy    = { ...ctx.envVars };
  const collectionCopy = { ...ctx.collectionVars };
  const globalsCopy    = { ...ctx.globals };
  const localVarsCopy  = { ...ctx.localVars };

  const scriptCtx: ScriptContext = {
    envVars: envVarsCopy,
    collectionVars: collectionCopy,
    globals: globalsCopy,
    localVars: localVarsCopy,
    response: ctx.response,
    piiMaskPatterns: ctx.piiMaskPatterns,
    data: ctx.data,
    libraries: ctx.libraries,
    libraryRoot: ctx.libraryRoot,
  };

  const sandbox = buildSandbox(scriptCtx, testResults, consoleOutput, faker, timeoutMs);

  const scopes = {
    updatedEnvVars: envVarsCopy,
    updatedCollectionVars: collectionCopy,
    updatedGlobals: globalsCopy,
    updatedLocalVars: localVarsCopy,
  };

  try {
    // `(code)` so a bare object literal / ternary is read as an expression, not
    // a block. Falls back to running as statements if that doesn't parse.
    let value: unknown;
    try {
      value = vm.runInNewContext(`(${code})`, sandbox, { timeout: timeoutMs, filename: 'expression.js' });
    } catch {
      value = vm.runInNewContext(code, sandbox, { timeout: timeoutMs, filename: 'expression.js' });
    }
    return { value, consoleOutput, ...scopes };
  } catch (err) {
    return { value: undefined, consoleOutput, ...scopes, error: err instanceof Error ? err.message : String(err) };
  }
}
