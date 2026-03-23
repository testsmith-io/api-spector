import * as vm from 'vm';
import dayjs from 'dayjs';
import tv4 from 'tv4';
import type { TestResult, ResponsePayload } from '../shared/types';
import type { faker as FakerType } from '@faker-js/faker';

// @faker-js/faker v10 is ESM-only — must use dynamic import
let _fakerCache: { faker: typeof FakerType } | null = null;
async function getFaker(): Promise<typeof FakerType> {
  if (!_fakerCache) _fakerCache = await import('@faker-js/faker');
  return _fakerCache.faker;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScriptContext {
  envVars: Record<string, string>
  collectionVars: Record<string, string>
  globals: Record<string, string>
  localVars: Record<string, string>
  response?: ResponsePayload
}

export interface ScriptOutput {
  testResults: TestResult[]
  consoleOutput: string[]
  updatedEnvVars: Record<string, string>
  updatedCollectionVars: Record<string, string>
  updatedGlobals: Record<string, string>
  updatedLocalVars: Record<string, string>
  error?: string
}

// ─── Chainable Asserter ───────────────────────────────────────────────────────

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

  return asserter;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

// ─── Build sp object ──────────────────────────────────────────────────────────

function buildAt(
  ctx: ScriptContext,
  testResults: TestResult[],
  consoleOutput: string[],
) {
  const { envVars, collectionVars, globals, localVars } = ctx;

  function makeVarScope(store: Record<string, string>, scopeName: string) {
    return {
      get: (key: string) => store[key] ?? null,
      set: (key: string, value: string) => {
        store[key] = String(value);
        consoleOutput.push(`[set] ${scopeName}.${key} = ${JSON.stringify(String(value))}`);
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
    environment:         makeVarScope(envVars,         'environment'),
    collectionVariables: makeVarScope(collectionVars,  'collectionVariables'),
    globals:             makeVarScope(globals,          'globals'),

    // Convenience: get/set across all scopes (local wins)
    variables_get: (key: string) =>
      localVars[key] ?? envVars[key] ?? collectionVars[key] ?? globals[key] ?? null,
    variables_set: (key: string, value: string) => { localVars[key] = String(value); },

    // Test runner
    test: (name: string, fn: () => void) => {
      try {
        fn();
        testResults.push({ name, passed: true });
      } catch (err) {
        testResults.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    // Expect / assertions
    expect: (value: unknown) => makeAsserter(value, false),
  };

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

// ─── Main entry point ─────────────────────────────────────────────────────────

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

  const scriptCtx: ScriptContext = {
    envVars:        envVarsCopy,
    collectionVars: collectionCopy,
    globals:        globalsCopy,
    localVars:      localVarsCopy,
    response:       ctx.response,
  };

  const sp = buildAt(scriptCtx, testResults, consoleOutput);

  const captureConsole = {
    log:   (...args: unknown[]) => consoleOutput.push(args.map(String).join(' ')),
    warn:  (...args: unknown[]) => consoleOutput.push('[warn] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => consoleOutput.push('[error] ' + args.map(String).join(' ')),
    info:  (...args: unknown[]) => consoleOutput.push('[info] ' + args.map(String).join(' ')),
  };

  const sandbox = {
    sp,
    dayjs,
    faker,
    tv4,
    console: captureConsole,
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: undefined,  // not available in sync vm context
    setInterval: undefined,
  };

  try {
    vm.runInNewContext(code, sandbox, { timeout: timeoutMs, filename: 'script.js' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      testResults,
      consoleOutput,
      updatedEnvVars:        envVarsCopy,
      updatedCollectionVars: collectionCopy,
      updatedGlobals:        globalsCopy,
      updatedLocalVars:      localVarsCopy,
      error: message,
    };
  }

  return {
    testResults,
    consoleOutput,
    updatedEnvVars:        envVarsCopy,
    updatedCollectionVars: collectionCopy,
    updatedGlobals:        globalsCopy,
    updatedLocalVars:      localVarsCopy,
  };
}
