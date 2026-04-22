// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { ApiRequest, Collection, Environment, EnvVariable, Folder, GeneratedFile } from '../../shared/types';
import { resolveInheritedAuthAndHeaders } from '../../shared/request-collection';
import { parsePostScript, accessorToJsonPath } from './script-parser';

// ─── Robot Framework generator ────────────────────────────────────────────────

function safeName(name: string): string {
  return name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function robotVar(key: string): string {
  return '${' + key.replace(/\W+/g, '_').toUpperCase() + '}';
}

function envVar(key: string): string {
  return '%{' + key.replace(/\W+/g, '_').toUpperCase() + '}';
}

/** Replace {{var}} with ${VAR} or %{VAR} depending on whether the var is secret. */
function interpolate(value: string, vars: Map<string, EnvVariable>): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const v = vars.get(key.trim());
    return v?.secret ? envVar(key.trim()) : robotVar(key.trim());
  });
}

/**
 * Pre-generate a unique keyword name for every request in the collection.
 * Both the keywords file and the test suite must use the same map so names stay in sync.
 */
function buildNameMap(root: Folder, requests: Collection['requests']): Map<string, string> {
  const map  = new Map<string, string>();
  const used = new Set<string>();

  function visit(folder: Folder) {
    for (const id of folder.requestIds) {
      const req = requests[id];
      if (!req || req.disabled) continue;
      const base = safeName(req.name);
      let name   = base;
      if (used.has(name)) {
        let i = 2;
        while (used.has(`${base} ${i}`)) i++;
        name = `${base} ${i}`;
      }
      used.add(name);
      map.set(id, name);
    }
    for (const sub of folder.folders) visit(sub);
  }

  visit(root);
  return map;
}

function buildVariablesFile(environment: Environment | null): string {
  const lines = ['*** Variables ***'];
  if (!environment) {
    lines.push('# No environment — add your variables here');
    lines.push('${BASE_URL}    http://localhost:8080');
    return lines.join('\n') + '\n';
  }
  for (const v of environment.variables) {
    if (!v.enabled) continue;
    if (v.secret) {
      lines.push(`# ${envVar(v.key)} — stored in OS keychain, never hardcoded`);
    } else {
      lines.push(`${robotVar(v.key)}    ${v.value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Try to render a JSON object body as RF VAR dict pairs (`k=v    k=v`).
 * Returns null for arrays or nested objects — those fall back to a scalar ${body}.
 */
function jsonToRfDictPairs(json: string, vars: Map<string, EnvVariable>): string | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const isFlat = Object.values(parsed).every(v => typeof v !== 'object' || v === null);
    if (!isFlat) return null;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}=${interpolate(String(v ?? ''), vars)}`)
      .join('    ');
  } catch {
    return null;
  }
}

function buildKeywordsFile(
  collection: Collection,
  varMap:     Map<string, EnvVariable>,
  nameMap:    Map<string, string>,
  hookExtractedVars: Set<string>,
): string {
  const lines = [
    '*** Settings ***',
    'Library    RequestsLibrary',
    'Library    Collections',
    'Resource    variables.resource',
    '',
    '*** Keywords ***',
  ];

  // Generate hook keywords (they extract variables and set them as suite vars)
  function processHooks(folder: Folder) {
    for (const reqId of folder.requestIds) {
      const req = collection.requests[reqId];
      if (!req || req.disabled || !req.hookType) continue;

      const kwName = nameMap.get(reqId);
      if (!kwName) continue;
      const url = interpolate(req.url, varMap);
      const method = req.method.charAt(0) + req.method.slice(1).toLowerCase();

      lines.push(kwName);
      lines.push(`    [Documentation]    Hook: ${req.hookType} — ${req.name}`);

      // Body
      const { body } = req;
      const hasBody = body.mode !== 'none' && !['GET', 'HEAD'].includes(req.method);
      if (hasBody && body.mode === 'json' && body.json) {
        const bodyPairs = jsonToRfDictPairs(body.json, varMap);
        if (bodyPairs !== null) {
          lines.push(`    VAR    &{body}    ${bodyPairs}`);
        } else {
          lines.push(`    VAR    \${body}    ${interpolate(body.json, varMap)}`);
        }
      }

      const callArgs: string[] = [];
      if (hasBody && body.mode === 'json') callArgs.push('json=${body}');

      lines.push(`    \${response}=    ${method}    ${url}`);
      if (callArgs.length) lines.push(`    ...    ${callArgs.join('    ')}`);

      // Extract variables from post-script
      const parsed = parsePostScript(req.postRequestScript);
      for (const e of parsed.extractions) {
        const jp = accessorToJsonPath(e.accessor);
        const rfVar = e.varName.replace(/\W+/g, '_').toUpperCase();
        hookExtractedVars.add(rfVar);
        lines.push(`    \${${rfVar}}=    Evaluate    str($response.json().get('${jp}', ''))`);
        lines.push(`    Set Suite Variable    \${${rfVar}}`);
      }

      lines.push(`    RETURN    \${response}`);
      lines.push('');
    }
    for (const sub of folder.folders) processHooks(sub);
  }

  processHooks(collection.rootFolder);

  // Generate regular request keywords
  function processFolder(folder: Folder) {
    for (const reqId of folder.requestIds) {
      const req = collection.requests[reqId];
      if (!req || req.disabled || req.hookType) continue;

      const kwName = nameMap.get(reqId)!;
      const url    = interpolate(req.url, varMap);

      lines.push(kwName);
      lines.push(`    [Documentation]    ${req.description || req.name}`);

      // ── Collect header pairs (inherited auth + custom) ─────────────────────
      const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
      const effectiveAuth = req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
      const allHeaders = [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];

      const headerPairs: string[] = [];

      if (effectiveAuth.type === 'bearer') {
        const token = effectiveAuth.token ?? '';
        if (token.includes('{{')) {
          // Check if it references a hook-extracted variable
          const varRef = token.match(/\{\{([^}]+)\}\}/)?.[1]?.trim();
          const rfVar = varRef ? varRef.replace(/\W+/g, '_').toUpperCase() : '';
          if (rfVar && hookExtractedVars.has(rfVar)) {
            headerPairs.push(`Authorization=Bearer \${${rfVar}}`);
          } else {
            headerPairs.push(`Authorization=Bearer ${interpolate(token, varMap)}`);
          }
        } else {
          const ref = effectiveAuth.tokenSecretRef ?? 'API_TOKEN';
          headerPairs.push(`Authorization=Bearer ${envVar(ref)}`);
        }
      } else if (effectiveAuth.type === 'basic') {
        const passRef = effectiveAuth.passwordSecretRef ?? 'API_PASSWORD';
        const user    = effectiveAuth.username ?? '';
        lines.push(`    \${credentials}=    Evaluate    base64.b64encode(f"${user}:${envVar(passRef)}".encode()).decode()    base64`);
        headerPairs.push(`Authorization=Basic \${credentials}`);
      } else if (effectiveAuth.type === 'apikey' && effectiveAuth.apiKeyIn === 'header') {
        const keyRef  = effectiveAuth.apiKeySecretRef ?? 'API_KEY';
        const keyName = effectiveAuth.apiKeyName ?? 'X-API-Key';
        headerPairs.push(`${keyName}=${envVar(keyRef)}`);
      }

      for (const h of allHeaders) {
        headerPairs.push(`${h.key}=${interpolate(h.value, varMap)}`);
      }

      if (headerPairs.length) {
        lines.push(`    VAR    &{headers}    ${headerPairs.join('    ')}`);
      }

      // ── Query params ────────────────────────────────────────────────────────
      const enabledParams = req.params.filter(p => p.enabled && p.key);
      if (enabledParams.length) {
        const pairs = enabledParams.map(p => `${p.key}=${interpolate(p.value, varMap)}`).join('    ');
        lines.push(`    VAR    &{params}    ${pairs}`);
      }

      // ── Request body ────────────────────────────────────────────────────────
      const { body } = req;
      const hasBody  = body.mode !== 'none' && !['GET', 'HEAD'].includes(req.method);
      if (hasBody && body.mode === 'json' && body.json) {
        const bodyPairs = jsonToRfDictPairs(body.json, varMap);
        if (bodyPairs !== null) {
          lines.push(`    VAR    &{body}    ${bodyPairs}`);
        } else {
          lines.push(`    VAR    \${body}    ${interpolate(body.json, varMap)}`);
        }
      }

      // ── HTTP call ───────────────────────────────────────────────────────────
      const method   = req.method.charAt(0) + req.method.slice(1).toLowerCase();
      const callArgs: string[] = [];
      if (headerPairs.length)                  callArgs.push('headers=${headers}');
      if (enabledParams.length)                callArgs.push('params=${params}');
      if (hasBody && body.mode === 'json')     callArgs.push('json=${body}');

      lines.push(`    \${response}=    ${method}    ${url}`);
      if (callArgs.length) {
        lines.push(`    ...    ${callArgs.join('    ')}`);
      }

      lines.push(`    RETURN    \${response}`);
      lines.push('');
    }

    for (const sub of folder.folders) processFolder(sub);
  }

  processFolder(collection.rootFolder);
  return lines.join('\n');
}

function buildTestSuite(
  collection:  Collection,
  environment: Environment | null,
  nameMap:     Map<string, string>,
): string {
  const colName = safeName(collection.name);
  const envName = environment?.name ?? 'default';

  // Collect beforeAll/afterAll hooks from every folder in the collection
  // (root + nested) so they fire as Suite Setup/Teardown.
  const beforeAllHooks: ApiRequest[] = [];
  const afterAllHooks:  ApiRequest[] = [];
  function collectAll(folder: Folder) {
    for (const id of folder.requestIds) {
      const r = collection.requests[id];
      if (!r || r.disabled) continue;
      if (r.hookType === 'beforeAll') beforeAllHooks.push(r);
      else if (r.hookType === 'afterAll') afterAllHooks.push(r);
    }
    for (const sub of folder.folders) collectAll(sub);
  }
  collectAll(collection.rootFolder);

  const suiteSetup = beforeAllHooks.length
    ? `Suite Setup    Run Keywords    ${beforeAllHooks.map(h => nameMap.get(h.id) ?? safeName(h.name)).join('    AND    ')}`
    : `Suite Setup    Log    Running ${colName} against ${envName} environment`;
  const suiteTeardown = afterAllHooks.length
    ? `Suite Teardown    Run Keywords    ${afterAllHooks.map(h => nameMap.get(h.id) ?? safeName(h.name)).join('    AND    ')}`
    : '';

  const lines = [
    '*** Settings ***',
    'Resource    ../resources/api_keywords.resource',
    '',
    suiteSetup,
    ...(suiteTeardown ? [suiteTeardown] : []),
    '',
    '*** Test Cases ***',
  ];

  function processFolder(folder: Folder) {
    for (const reqId of folder.requestIds) {
      const req = collection.requests[reqId];
      if (!req || req.disabled || req.hookType) continue;
      const kwName = nameMap.get(reqId)!;
      lines.push(kwName);
      lines.push(`    [Documentation]    ${req.description || req.name}`);
      lines.push(`    \${response}=    ${kwName}`);

      const parsed = parsePostScript(req.postRequestScript);
      if (parsed.assertions.length > 0) {
        for (const a of parsed.assertions) {
          const jp = accessorToJsonPath(a.accessor);
          switch (a.kind) {
            case 'status':
              lines.push(`    Status Should Be    ${a.expected ?? 200}    \${response}`);
              break;
            case 'equals': {
              const expected = a.expected?.replace(/^"|"$/g, '') ?? '';
              lines.push(`    \${value}=    Get From Dictionary    \${response.json()}    ${jp}`);
              lines.push(`    Should Be Equal As Strings    \${value}    ${expected}`);
              break;
            }
            case 'contains': {
              const expected = a.expected?.replace(/^"|"$/g, '') ?? '';
              lines.push(`    \${value}=    Get From Dictionary    \${response.json()}    ${jp}`);
              lines.push(`    Should Contain    \${value}    ${expected}`);
              break;
            }
            case 'exists':
              lines.push(`    Dictionary Should Contain Key    \${response.json()}    ${jp}`);
              break;
            default:
              lines.push(`    Status Should Be    200    \${response}`);
          }
        }
      } else {
        lines.push(`    Status Should Be    200    \${response}`);
      }

      for (const e of parsed.extractions) {
        const jp = accessorToJsonPath(e.accessor);
        lines.push(`    \${${e.varName}}=    Get From Dictionary    \${response.json()}    ${jp}`);
        lines.push(`    Set Suite Variable    \${${e.varName}}`);
      }

      lines.push('');
    }
    for (const sub of folder.folders) processFolder(sub);
  }

  processFolder(collection.rootFolder);
  return lines.join('\n');
}

// ─── README ───────────────────────────────────────────────────────────────────

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
  const tree = renderTree(filePaths);
  return `# ${collectionName} — API Tests (Robot Framework)

## Project structure

\`\`\`
${tree}
\`\`\`

> Secrets are read from OS environment variables (e.g. \`%{API_TOKEN}\`).
> Never hardcode secrets — export them in your shell or CI environment.

## Setup

\`\`\`sh
pip install -r requirements.txt

# Run all tests
robot tests/

# Override base URL
BASE_URL=https://staging.example.com robot tests/
\`\`\`
`;
}

export function generateRobotFramework(
  collection:  Collection,
  environment: Environment | null,
): GeneratedFile[] {
  const varMap  = new Map<string, EnvVariable>(
    (environment?.variables ?? []).map(v => [v.key, v])
  );
  const nameMap = buildNameMap(collection.rootFolder, collection.requests);
  const slug    = collection.name.replace(/\W+/g, '_').toLowerCase();

  const hookExtractedVars = new Set<string>();
  const contentFiles: GeneratedFile[] = [
    { path: 'resources/variables.resource',     content: buildVariablesFile(environment) },
    { path: 'resources/api_keywords.resource', content: buildKeywordsFile(collection, varMap, nameMap, hookExtractedVars) },
    { path: `tests/test_${slug}.robot`,        content: buildTestSuite(collection, environment, nameMap) },
  ];

  const allPaths = ['requirements.txt', ...contentFiles.map(f => f.path)];

  return [
    { path: 'README.md',          content: buildReadme(collection.name, allPaths) },
    { path: 'requirements.txt',   content: 'robotframework\nrobotframework-requests\n' },
    ...contentFiles,
  ];
}
