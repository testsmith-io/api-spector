// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment, Folder, GeneratedFile } from '../../shared/types';

// ─── Playwright TypeScript generator ─────────────────────────────────────────

function slug(name: string): string {
  return name.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '');
}

function toEnvVar(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

function interpolatePath(value: string): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => `\${process.env.${toEnvVar(key.trim())} ?? ''}`);
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

/** Render a parsed JSON value as a JS literal, converting {{VAR}} to template expressions. */
function renderJsValue(value: unknown, indent: string): string {
  const next = indent + '  ';
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('{{')) {
      const s = value.replace(/\{\{([^}]+)\}\}/g, (_, k) => `\${process.env.${toEnvVar(k.trim())} ?? ''}`);
      return '`' + s + '`';
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(v => next + renderJsValue(v, next)).join(',\n')},\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${next}${k}: ${renderJsValue(v, next)}`).join(',\n')},\n${indent}}`;
  }
  return JSON.stringify(value);
}

// ─── playwright.config.ts ─────────────────────────────────────────────────────

function buildPlaywrightConfig(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:3000';

  return `import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL ?? '${baseUrl}',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
})
`;
}

// ─── Test spec ────────────────────────────────────────────────────────────────

function buildSpec(folderName: string, folder: Folder, requests: Collection['requests'], nameMap: Map<string, string>): string {
  const tests: string[] = [];

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req) continue;

    const testName = nameMap.get(reqId) ?? req.name;
    const method   = req.method.toLowerCase();

    // Path relative to baseURL
    const path = req.url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\{\{[^}]+\}\}/, '')
      || '/';
    const pathExpr = path.includes('{{')
      ? '`' + interpolatePath(path) + '`'
      : `'${path}'`;

    // Options: headers, params, data
    const optionParts: string[] = [];

    // Auth + custom headers
    const headerEntries: string[] = [];
    const { auth } = req;
    if (auth.type === 'bearer') {
      const ref = auth.tokenSecretRef ?? 'API_TOKEN';
      headerEntries.push(`Authorization: \`Bearer \${process.env.${toEnvVar(ref)} ?? ''}\``);
    } else if (auth.type === 'apikey' && auth.apiKeyIn === 'header') {
      const ref  = auth.apiKeySecretRef ?? 'API_KEY';
      const name = auth.apiKeyName ?? 'X-API-Key';
      headerEntries.push(`'${name}': \`\${process.env.${toEnvVar(ref)} ?? ''}\``);
    }
    for (const h of req.headers.filter(h => h.enabled && h.key)) {
      headerEntries.push(`'${h.key}': \`${interpolatePath(h.value)}\``);
    }
    if (headerEntries.length) {
      optionParts.push(`      headers: {\n        ${headerEntries.join(',\n        ')},\n      }`);
    }

    // Query params
    const enabledParams = req.params.filter(p => p.enabled && p.key);
    if (enabledParams.length) {
      const pairs = enabledParams.map(p => `'${p.key}': '${interpolatePath(p.value)}'`).join(', ');
      optionParts.push(`      params: { ${pairs} }`);
    }

    // Request body
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);
    if (hasBody && req.body.mode === 'json' && req.body.json) {
      try {
        const rendered = renderJsValue(JSON.parse(req.body.json), '      ');
        optionParts.push(`      data: ${rendered}`);
      } catch {
        optionParts.push(`      data: \`${interpolatePath(req.body.json)}\``);
      }
    }

    const optionsStr = optionParts.length ? `, {\n${optionParts.join(',\n')},\n    }` : '';

    tests.push([
      `  test('${testName}', async ({ request }) => {`,
      `    const response = await request.${method}(${pathExpr}${optionsStr});`,
      `    expect(response.ok()).toBeTruthy();`,
      `  });`,
    ].join('\n'));
  }

  return `import { test, expect } from '@playwright/test'

test.describe('${folderName}', () => {

${tests.join('\n\n')}

})
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
      typescript:        '^5.4.0',
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
  return `# ${collectionName} — API Tests (Playwright TypeScript)

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

export function generatePlaywright(
  collection:  Collection,
  environment: Environment | null,
): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.length > 0) {
      const nameMap = buildNameMap(folder, collection.requests);
      files.push({ path: `tests/${slug(name)}.spec.ts`, content: buildSpec(name, folder, collection.requests, nameMap) });
    }
    for (const sub of folder.folders) processFolder(sub, sub.name);
  }

  if (collection.rootFolder.requestIds.length > 0) processFolder(collection.rootFolder, collection.name);
  for (const sub of collection.rootFolder.folders) processFolder(sub, sub.name);

  const scaffoldPaths = ['package.json', 'playwright.config.ts', ...files.map(f => f.path)];
  files.unshift(
    { path: 'package.json',          content: buildPackageJson(collection.name) },
    { path: 'playwright.config.ts',  content: buildPlaywrightConfig(environment) },
    { path: 'README.md',             content: buildReadme(collection.name, scaffoldPaths) },
  );

  return files;
}
