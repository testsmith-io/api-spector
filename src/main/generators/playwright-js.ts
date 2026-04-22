// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment, Folder, GeneratedFile, ApiRequest } from '../../shared/types';
import { resolveInheritedAuthAndHeaders, getAllApplicableHooks } from '../../shared/request-collection';
import { parsePostScript } from './script-parser';

// ─── Playwright JavaScript generator ─────────────────────────────────────────

function slug(name: string): string {
  return name.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '');
}

function toEnvVar(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

function interpolatePath(value: string, sharedVars: Set<string> = new Set()): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const envKey = toEnvVar(key.trim());
    return sharedVars.has(envKey) ? `\${${envKey}}` : `\${process.env.${envKey} ?? ''}`;
  });
}

function buildNameMap(folder: Folder, requests: Collection['requests']): Map<string, string> {
  const map  = new Map<string, string>();
  const used = new Set<string>();
  for (const id of folder.requestIds) {
    const req = requests[id];
    if (!req) continue;
    const base = req.name;
    let name = base;
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${base} ${i}`)) i++;
      name = `${base} ${i}`;
    }
    used.add(name);
    map.set(id, name);
  }
  return map;
}

function renderJsValue(value: unknown, indent: string, sharedVars: Set<string> = new Set()): string {
  const next = indent + '  ';
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('{{')) {
      return '`' + interpolatePath(value, sharedVars) + '`';
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(v => next + renderJsValue(v, next, sharedVars)).join(',\n')},\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${next}${k}: ${renderJsValue(v, next, sharedVars)}`).join(',\n')},\n${indent}}`;
  }
  return JSON.stringify(value);
}

// ─── playwright.config.js ─────────────────────────────────────────────────────

function buildPlaywrightConfig(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:3000';

  return `// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: '.env.local' });

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL ?? '${baseUrl}',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
`;
}

// ─── Test spec ────────────────────────────────────────────────────────────────

/** Build lines for a hook request, extracting variables from the response. */
function buildHookLines(req: ApiRequest, sharedVars: Set<string>): string[] {
  const method = req.method.toLowerCase();
  const path = req.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\{\{[^}]+\}\}/, '') || '/';
  const pathExpr = path.includes('{{') ? '`' + interpolatePath(path) + '`' : `'${path}'`;
  const headerEntries: string[] = [];
  if (req.auth.type === 'bearer') {
    const token = req.auth.token ?? '';
    if (token.includes('{{')) {
      headerEntries.push(`Authorization: \`Bearer ${interpolatePath(token)}\``);
    } else {
      const ref = req.auth.tokenSecretRef ?? 'API_TOKEN';
      headerEntries.push(`Authorization: \`Bearer \${process.env.${toEnvVar(ref)} ?? ''}\``);
    }
  }
  for (const h of req.headers.filter(h => h.enabled && h.key)) {
    headerEntries.push(`'${h.key}': \`${interpolatePath(h.value)}\``);
  }
  const optParts: string[] = [];
  if (headerEntries.length) optParts.push(`headers: { ${headerEntries.join(', ')} }`);
  if (req.body.mode === 'json' && req.body.json && !['get', 'head'].includes(method)) {
    try { optParts.push(`data: ${renderJsValue(JSON.parse(req.body.json), '        ')}`); } catch { /* skip */ }
  }
  const opts = optParts.length ? `, { ${optParts.join(', ')} }` : '';

  const lines: string[] = [`    // ${req.name}`];
  const parsed = parsePostScript(req.postRequestScript);
  if (parsed.extractions.length > 0) {
    lines.push(`    const hookResponse = await request.${method}(${pathExpr}${opts});`);
    lines.push(`    const hookJson = await hookResponse.json();`);
    for (const e of parsed.extractions) {
      const jp = e.accessor.replace(/^json\.?/, '');
      const expr = jp ? `hookJson.${jp}` : 'hookJson';
      const varName = toEnvVar(e.varName);
      sharedVars.add(varName);
      lines.push(`    ${varName} = String(${expr});`);
    }
  } else {
    lines.push(`    await request.${method}(${pathExpr}${opts});`);
  }
  return lines;
}

function buildSpec(folderName: string, folder: Folder, collection: Collection, nameMap: Map<string, string>): string {
  const requests = collection.requests;
  const tests: string[] = [];

  // Hook blocks (collected from this folder + all ancestors)
  const hooks = getAllApplicableHooks(folder.id, collection);
  const beforeAllHooks = hooks.beforeAll;
  const beforeHooks    = hooks.before;
  const afterHooks     = hooks.after;
  const afterAllHooks  = hooks.afterAll;

  const sharedVars = new Set<string>();
  const hookBlocks: string[] = [];
  if (beforeAllHooks.length) {
    const lines = beforeAllHooks.flatMap(h => buildHookLines(h, sharedVars));
    hookBlocks.push(`  test.beforeAll(async ({ request }) => {\n${lines.join('\n')}\n  });\n`);
  }
  if (beforeHooks.length) {
    const lines = beforeHooks.flatMap(h => buildHookLines(h, sharedVars));
    hookBlocks.push(`  test.beforeEach(async ({ request }) => {\n${lines.join('\n')}\n  });\n`);
  }
  if (afterHooks.length) {
    const lines = afterHooks.flatMap(h => buildHookLines(h, sharedVars));
    hookBlocks.push(`  test.afterEach(async ({ request }) => {\n${lines.join('\n')}\n  });\n`);
  }
  if (afterAllHooks.length) {
    const lines = afterAllHooks.flatMap(h => buildHookLines(h, sharedVars));
    hookBlocks.push(`  test.afterAll(async ({ request }) => {\n${lines.join('\n')}\n  });\n`);
  }

  for (const v of sharedVars) tests.push(`  let ${v} = '';`);
  if (sharedVars.size) tests.push('');
  tests.push(...hookBlocks);

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.disabled || req.hookType) continue;

    const testName = nameMap.get(reqId) ?? req.name;
    const method   = req.method.toLowerCase();

    const path = req.url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\{\{[^}]+\}\}/, '')
      || '/';
    const pathExpr = path.includes('{{')
      ? '`' + interpolatePath(path, sharedVars) + '`'
      : `'${path}'`;

    const optionParts: string[] = [];

    // Auth + headers (including inherited from collection/folder)
    const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
    const effectiveAuth = req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
    const allHeaders = [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];

    const headerEntries: string[] = [];
    if (effectiveAuth.type === 'bearer') {
      const token = effectiveAuth.token ?? '';
      if (token.includes('{{')) {
        headerEntries.push(`Authorization: \`Bearer ${interpolatePath(token, sharedVars)}\``);
      } else {
        const ref = effectiveAuth.tokenSecretRef ?? 'API_TOKEN';
        headerEntries.push(`Authorization: \`Bearer \${process.env.${toEnvVar(ref)} ?? ''}\``);
      }
    } else if (effectiveAuth.type === 'apikey' && effectiveAuth.apiKeyIn === 'header') {
      const val = effectiveAuth.apiKeyValue ?? '';
      const name = effectiveAuth.apiKeyName ?? 'X-API-Key';
      if (val.includes('{{')) {
        headerEntries.push(`'${name}': \`${interpolatePath(val, sharedVars)}\``);
      } else {
        const ref = effectiveAuth.apiKeySecretRef ?? 'API_KEY';
        headerEntries.push(`'${name}': \`\${process.env.${toEnvVar(ref)} ?? ''}\``);
      }
    }
    for (const h of allHeaders) {
      headerEntries.push(`'${h.key}': \`${interpolatePath(h.value, sharedVars)}\``);
    }
    if (headerEntries.length) {
      optionParts.push(`      headers: {\n        ${headerEntries.join(',\n        ')},\n      }`);
    }

    const enabledParams = req.params.filter(p => p.enabled && p.key);
    if (enabledParams.length) {
      const pairs = enabledParams.map(p => p.value.includes('{{')
        ? `'${p.key}': \`${interpolatePath(p.value, sharedVars)}\``
        : `'${p.key}': '${p.value}'`
      ).join(', ');
      optionParts.push(`      params: { ${pairs} }`);
    }

    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);
    if (hasBody && req.body.mode === 'json' && req.body.json) {
      try {
        const rendered = renderJsValue(JSON.parse(req.body.json), '      ', sharedVars);
        optionParts.push(`      data: ${rendered}`);
      } catch {
        optionParts.push(`      data: \`${interpolatePath(req.body.json, sharedVars)}\``);
      }
    }

    const optionsStr = optionParts.length ? `, {\n${optionParts.join(',\n')},\n    }` : '';

    const parsed = parsePostScript(req.postRequestScript);
    const lines: string[] = [
      `  test('${testName}', async ({ request }) => {`,
      `    const response = await request.${method}(${pathExpr}${optionsStr});`,
    ];

    const needsJson = parsed.assertions.some(a => a.accessor.startsWith('json')) ||
                      parsed.extractions.length > 0;
    if (needsJson) {
      lines.push(`    const json = await response.json();`);
    }

    if (parsed.assertions.length > 0) {
      for (const a of parsed.assertions) {
        const path = a.accessor.replace(/^json\.?/, '');
        const jsonExpr = path ? `json.${path}` : 'json';
        switch (a.kind) {
          case 'status':
            lines.push(a.expected ? `    expect(response.status()).toBe(${a.expected});` : `    expect(response.ok()).toBeTruthy();`);
            break;
          case 'equals':   lines.push(`    expect(${jsonExpr}).toBe(${a.expected});`); break;
          case 'contains': lines.push(`    expect(${jsonExpr}).toContain(${a.expected});`); break;
          case 'exists':   lines.push(`    expect(${jsonExpr}).toBeDefined();`); break;
          case 'type':     lines.push(`    expect(typeof ${jsonExpr}).toBe(${a.expected});`); break;
          case 'above':    lines.push(`    expect(${jsonExpr}).toBeGreaterThan(${a.expected});`); break;
        }
      }
    } else {
      lines.push(`    expect(response.ok()).toBeTruthy();`);
    }

    for (const e of parsed.extractions) {
      const path = e.accessor.replace(/^json\.?/, '');
      const expr = path ? `json.${path}` : 'json';
      lines.push(`    process.env.${toEnvVar(e.varName)} = String(${expr});`);
    }

    lines.push(`  });`);
    tests.push(lines.join('\n'));
  }

  return `const { test, expect } = require('@playwright/test');

test.describe('${folderName}', () => {

${tests.join('\n\n')}

});
`;
}

// ─── Project scaffolding ──────────────────────────────────────────────────────

function buildPackageJson(collectionName: string): string {
  const name = collectionName.replace(/\W+/g, '-').toLowerCase();
  return JSON.stringify({
    name: `${name}-api-tests`,
    version: '1.0.0',
    private: true,
    scripts: {
      test: 'playwright test',
      'test:report': 'playwright show-report',
    },
    devDependencies: {
      '@playwright/test': '^1.44.0',
      dotenv:            '^16.4.0',
    },
  }, null, 2) + '\n';
}

function renderTree(paths: string[]): string {
  interface Node { [k: string]: Node }
  const root: Node = {};
  for (const p of [...paths].sort()) {
    let cur = root;
    for (const part of p.split('/')) { cur = (cur[part] ??= {}); }
  }
  function render(node: Node, prefix = ''): string[] {
    const entries = Object.entries(node);
    return entries.flatMap(([name, children], i) => {
      const last = i === entries.length - 1;
      const lines = [`${prefix}${last ? '└── ' : '├── '}${name}`];
      if (Object.keys(children).length) lines.push(...render(children, prefix + (last ? '    ' : '│   ')));
      return lines;
    });
  }
  return ['.', ...render(root)].join('\n');
}

function buildReadme(collectionName: string, filePaths: string[]): string {
  const tree = renderTree([...filePaths, '.env.local']);
  return `# ${collectionName} — API Tests (Playwright JavaScript)

## Project structure

\`\`\`
${tree}
\`\`\`

> \`.env.local\` is git-ignored — fill in your secrets before running.

## Setup

\`\`\`sh
npm install
npx playwright install --with-deps chromium
npm test
\`\`\`
`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function generatePlaywrightJs(
  collection:  Collection,
  environment: Environment | null,
): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.length > 0) {
      const nameMap = buildNameMap(folder, collection.requests);
      files.push({ path: `tests/${slug(name)}.spec.js`, content: buildSpec(name, folder, collection, nameMap) });
    }
    for (const sub of folder.folders) processFolder(sub, sub.name);
  }

  if (collection.rootFolder.requestIds.length > 0) processFolder(collection.rootFolder, collection.name);
  for (const sub of collection.rootFolder.folders) processFolder(sub, sub.name);

  const scaffoldPaths = ['package.json', 'playwright.config.js', ...files.map(f => f.path)];
  files.unshift(
    { path: 'package.json',          content: buildPackageJson(collection.name) },
    { path: 'playwright.config.js',  content: buildPlaywrightConfig(environment) },
    { path: 'README.md',             content: buildReadme(collection.name, scaffoldPaths) },
  );

  return files;
}
