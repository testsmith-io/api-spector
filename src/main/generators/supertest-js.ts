// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment, Folder, GeneratedFile } from '../../shared/types';
import { resolveInheritedAuthAndHeaders, getAllApplicableHooks } from '../../shared/request-collection';
import { parsePostScript } from './script-parser';

// ─── Supertest + Jest JavaScript generator ────────────────────────────────────

function slug(name: string): string {
  return name.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '');
}

function toEnvVar(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

function interpolateValue(value: string, sharedVars: Set<string> = new Set()): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const envKey = toEnvVar(key.trim());
    return sharedVars.has(envKey) ? `\${${envKey}}` : `\${process.env.${envKey} ?? ''}`;
  });
}

function buildJestConfig(): string {
  return `\
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['dotenv/config'],
}
`;
}

function buildClient(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:3000';

  const secretVars = environment?.variables.filter(v => v.secret && v.secretRef) ?? [];
  const envComments = secretVars.map(v => `# ${toEnvVar(v.key)}=<from keychain>`).join('\n');

  return `\
const supertest = require('supertest');
require('dotenv').config({ path: '.env.local' });

// Add secret env vars to .env.local:
${envComments ? `// ${envComments.replace(/\n/g, '\n// ')}\n` : ''}\
const BASE_URL = process.env.BASE_URL ?? '${baseUrl}';

module.exports.api = supertest(BASE_URL);
`;
}

function buildTestFile(folderName: string, folder: Folder, collection: Collection): string {
  const requests = collection.requests;
  const tests: string[] = [];

  const used = new Set<string>();
  const nameMap = new Map<string, string>();
  for (const id of folder.requestIds) {
    const req = requests[id];
    if (!req || req.disabled || req.hookType) continue;
    const base = req.name;
    let name = base;
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${base} ${i}`)) i++;
      name = `${base} ${i}`;
    }
    used.add(name);
    nameMap.set(id, name);
  }

  // Hook blocks (collected from this folder + all ancestors) with variable extraction
  const hooks = getAllApplicableHooks(folder.id, collection);
  const beforeAllH = hooks.beforeAll;
  const afterAllH  = hooks.afterAll;
  const sharedVars = new Set<string>();

  function buildJsHookLines(h: typeof beforeAllH[0]): string[] {
    const lines: string[] = [`    // ${h.name}`];
    const method = h.method.toLowerCase();
    const path = h.url.replace(/^https?:\/\/[^/]+/, '') || '/';
    const parsed = parsePostScript(h.postRequestScript);
    if (parsed.extractions.length > 0) {
      lines.push(`    const hookRes = await api.${method}('${path}');`);
      for (const e of parsed.extractions) {
        const jp = e.accessor.replace(/^json\.?/, '');
        const expr = jp ? `hookRes.body.${jp}` : 'hookRes.body';
        const varName = toEnvVar(e.varName);
        sharedVars.add(varName);
        lines.push(`    ${varName} = String(${expr});`);
      }
    } else {
      lines.push(`    await api.${method}('${path}');`);
    }
    return lines;
  }

  const hookBlocks: string[] = [];
  if (beforeAllH.length) {
    const lines = beforeAllH.flatMap(buildJsHookLines);
    hookBlocks.push(`  beforeAll(async () => {\n${lines.join('\n')}\n  });\n`);
  }
  if (afterAllH.length) {
    const lines = afterAllH.flatMap(buildJsHookLines);
    hookBlocks.push(`  afterAll(async () => {\n${lines.join('\n')}\n  });\n`);
  }

  for (const v of sharedVars) tests.push(`  let ${v} = '';`);
  if (sharedVars.size) tests.push('');
  tests.push(...hookBlocks);

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.disabled || req.hookType) continue;

    const method = req.method.toLowerCase();
    const path = interpolateValue(req.url.replace(/^https?:\/\/[^/]+/, '') || '/', sharedVars);

    // Inherited auth + headers
    const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
    const effectiveAuth = req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
    const allHeaders = [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];
    const enabledParams = req.params.filter(p => p.enabled && p.key);
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);

    const lines: string[] = [];
    lines.push(`  it('${nameMap.get(reqId)}', async () => {`);
    lines.push(`    const res = await api`);
    lines.push(`      .${method}(\`${path}\`)`);

    if (effectiveAuth.type === 'bearer') {
      const token = effectiveAuth.token ?? '';
      if (token.includes('{{')) {
        lines.push(`      .set('Authorization', \`Bearer ${interpolateValue(token, sharedVars)}\`)`);
      } else {
        const ref = effectiveAuth.tokenSecretRef ?? 'API_TOKEN';
        lines.push(`      .set('Authorization', \`Bearer \${process.env.${toEnvVar(ref)} ?? ''}\`)`);
      }
    }

    for (const h of allHeaders) {
      lines.push(`      .set('${h.key}', \`${interpolateValue(h.value, sharedVars)}\`)`);
    }

    if (enabledParams.length) {
      const pairs = enabledParams.map(p => `${p.key}: \`${interpolateValue(p.value, sharedVars)}\``).join(', ');
      lines.push(`      .query({ ${pairs} })`);
    }

    if (hasBody) {
      if (req.body.mode === 'json') {
        const jsonBody = req.body.json ?? '{}';
        if (jsonBody.includes('{{')) {
          lines.push(`      .send(JSON.parse(\`${interpolateValue(jsonBody, sharedVars)}\`))`);
        } else {
          lines.push(`      .send(${jsonBody})`);
        }
      } else if (req.body.mode === 'form' && req.body.form) {
        const pairs = req.body.form.filter(p => p.enabled && p.key)
          .map(p => `${p.key}: \`${interpolateValue(p.value, sharedVars)}\``).join(', ');
        lines.push(`      .type('form')`);
        lines.push(`      .send({ ${pairs} })`);
      }
    }

    lines[lines.length - 1] += ';';
    lines.push(``);

    const parsed = parsePostScript(req.postRequestScript);
    if (parsed.assertions.length > 0) {
      for (const a of parsed.assertions) {
        const path = a.accessor.replace(/^json\.?/, '');
        const bodyExpr = path ? `res.body.${path}` : 'res.body';
        switch (a.kind) {
          case 'status':
            lines.push(`    expect(res.status).toBe(${a.expected ?? 200});`);
            break;
          case 'equals':   lines.push(`    expect(${bodyExpr}).toBe(${a.expected});`); break;
          case 'contains': lines.push(`    expect(${bodyExpr}).toContain(${a.expected});`); break;
          case 'exists':   lines.push(`    expect(${bodyExpr}).toBeDefined();`); break;
          case 'type':     lines.push(`    expect(typeof ${bodyExpr}).toBe(${a.expected});`); break;
          case 'above':    lines.push(`    expect(${bodyExpr}).toBeGreaterThan(${a.expected});`); break;
        }
      }
    } else {
      lines.push(`    expect(res.status).toBe(200);`);
    }

    for (const e of parsed.extractions) {
      const path = e.accessor.replace(/^json\.?/, '');
      const expr = path ? `res.body.${path}` : 'res.body';
      lines.push(`    process.env.${toEnvVar(e.varName)} = String(${expr});`);
    }

    lines.push(`  })`);

    tests.push(lines.join('\n'));
  }

  return `\
const { api } = require('../helpers/api-client');

describe('${folderName}', () => {
${tests.join('\n\n')}
})
`;
}

// ─── Project scaffolding files ────────────────────────────────────────────────

function buildPackageJson(collectionName: string): string {
  const name = collectionName.replace(/\W+/g, '-').toLowerCase();
  return JSON.stringify({
    name: `${name}-api-tests`,
    version: '1.0.0',
    private: true,
    scripts: { test: 'jest' },
    devDependencies: {
      dotenv:    '^16.4.0',
      jest:      '^29.7.0',
      supertest: '^7.0.0',
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
  return `# ${collectionName} — API Tests (Supertest + Jest JavaScript)

## Project structure

\`\`\`
${tree}
\`\`\`

> \`.env.local\` is git-ignored — fill in your secrets before running.

## Setup

\`\`\`sh
npm install
npm test
\`\`\`
`;
}

export function generateSupertestJs(
  collection: Collection,
  environment: Environment | null
): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: 'jest.config.js',        content: buildJestConfig() },
    { path: 'helpers/api-client.js', content: buildClient(environment) },
  ];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.length > 0) {
      files.push({
        path: `tests/${slug(name)}.test.js`,
        content: buildTestFile(name, folder, collection),
      });
    }
    for (const sub of folder.folders) {
      processFolder(sub, sub.name);
    }
  }

  if (collection.rootFolder.requestIds.length > 0) {
    processFolder(collection.rootFolder, collection.name);
  }
  for (const sub of collection.rootFolder.folders) {
    processFolder(sub, sub.name);
  }

  const scaffoldPaths = ['package.json', ...files.map(f => f.path)];
  files.unshift(
    { path: 'package.json', content: buildPackageJson(collection.name) },
    { path: 'README.md',    content: buildReadme(collection.name, scaffoldPaths) },
  );

  return files;
}
