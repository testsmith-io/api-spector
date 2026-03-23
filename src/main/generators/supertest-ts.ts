import type { Collection, Environment, Folder, GeneratedFile } from '../../shared/types';

// ─── Supertest + Jest TypeScript generator ────────────────────────────────────

function slug(name: string): string {
  return name.replace(/\W+/g, '-').toLowerCase().replace(/^-|-$/g, '');
}

function toEnvVar(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

function interpolateValue(value: string): string {
  // Replaces {{var}} with `${process.env.VAR ?? ''}`
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => `\${process.env.${toEnvVar(key.trim())} ?? ''}`);
}

// ─── jest.config.ts ────────────────────────────────────────────────────────────

function buildJestConfig(): string {
  return `\
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['dotenv/config'],
}

export default config
`;
}

// ─── helpers/api-client.ts ────────────────────────────────────────────────────

function buildClient(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:3000';

  const secretVars = environment?.variables.filter(v => v.secret && v.secretRef) ?? [];
  const envComments = secretVars.map(v => `# ${toEnvVar(v.key)}=<from keychain>`).join('\n');

  return `\
import supertest from 'supertest'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' });

// Add secret env vars to .env.local:
${envComments ? `// ${envComments.replace(/\n/g, '\n// ')}\n` : ''}\
export const BASE_URL = process.env.BASE_URL ?? '${baseUrl}';

export const api = supertest(BASE_URL);
`;
}

// ─── Test file per folder ─────────────────────────────────────────────────────

function buildTestFile(folderName: string, folder: Folder, requests: Collection['requests']): string {
  const tests: string[] = [];

  const used = new Set<string>();
  const nameMap = new Map<string, string>();
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
    nameMap.set(id, name);
  }

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req) continue;

    const method = req.method.toLowerCase();
    const path = interpolateValue(req.url.replace(/^https?:\/\/[^/]+/, '') || '/');
    const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
    const enabledParams  = req.params.filter(p => p.enabled && p.key);
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);

    const lines: string[] = [];
    lines.push(`  it('${nameMap.get(reqId)}', async () => {`);
    lines.push(`    const res = await api`);
    lines.push(`      .${method}(\`${path}\`)`);

    for (const h of enabledHeaders) {
      lines.push(`      .set('${h.key}', \`${interpolateValue(h.value)}\`)`);
    }

    if (enabledParams.length) {
      const pairs = enabledParams.map(p => `${p.key}: \`${interpolateValue(p.value)}\``).join(', ');
      lines.push(`      .query({ ${pairs} })`);
    }

    if (hasBody) {
      if (req.body.mode === 'json') {
        lines.push(`      .send(${req.body.json ?? '{}'})`);
      } else if (req.body.mode === 'form' && req.body.form) {
        const pairs = req.body.form.filter(p => p.enabled && p.key)
          .map(p => `${p.key}: \`${interpolateValue(p.value)}\``).join(', ');
        lines.push(`      .type('form')`);
        lines.push(`      .send({ ${pairs} })`);
      }
    }

    lines[lines.length - 1] += ';';
    lines.push(``);
    lines.push(`    expect(res.status).toBe(200);`);
    lines.push(`    // expect(res.body).toMatchObject({});`);
    lines.push(`  })`);

    tests.push(lines.join('\n'));
  }

  return `\
import { api } from '../helpers/api-client'

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
      '@types/jest':      '^29.5.0',
      '@types/supertest': '^6.0.0',
      dotenv:             '^16.4.0',
      jest:               '^29.7.0',
      supertest:          '^7.0.0',
      'ts-jest':          '^29.1.0',
      'ts-node':          '^10.9.2',
      typescript:         '^5.4.0',
    },
  }, null, 2) + '\n';
}

function buildTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      strict: true,
      esModuleInterop: true,
      outDir: 'dist',
    },
    include: ['**/*.ts'],
    exclude: ['node_modules', 'dist'],
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
  return `# ${collectionName} — API Tests (Supertest + Jest TypeScript)

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

// ─── Main entry ───────────────────────────────────────────────────────────────

export function generateSupertestTs(
  collection: Collection,
  environment: Environment | null
): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: 'jest.config.ts',          content: buildJestConfig() },
    { path: 'helpers/api-client.ts',   content: buildClient(environment) },
  ];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.length > 0) {
      files.push({
        path: `tests/${slug(name)}.test.ts`,
        content: buildTestFile(name, folder, collection.requests),
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

  const scaffoldPaths = ['package.json', 'tsconfig.json', ...files.map(f => f.path)];
  files.unshift(
    { path: 'package.json',   content: buildPackageJson(collection.name) },
    { path: 'tsconfig.json',  content: buildTsConfig() },
    { path: 'README.md',      content: buildReadme(collection.name, scaffoldPaths) },
  );

  return files;
}
