// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { ApiRequest, Collection, Environment, EnvVariable, Folder, GeneratedFile } from '../../shared/types';
import { resolveInheritedAuthAndHeaders } from '../../shared/request-collection';
import { parsePostScript, accessorToJsonPath } from './script-parser';
import { resolveEffectiveAuth, mergeHeaders, hasBody, renderTree, ROBOT_REQUESTS_METHODS } from './generator-utils';

// ─── Robot Framework generator ────────────────────────────────────────────────

function safeName(name: string): string {
  return name.replaceAll(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function robotVar(key: string): string {
  return '${' + key.replaceAll(/\W+/g, '_').toUpperCase() + '}';
}

function envVar(key: string): string {
  return '%{' + key.replaceAll(/\W+/g, '_').toUpperCase() + '}';
}

/** Replace {{var}} with ${VAR} or %{VAR} depending on whether the var is secret. */
function interpolate(value: string, vars: Map<string, EnvVariable>): string {
  return value.replaceAll(/\{\{([^}]+)\}\}/g, (_, key) => {
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
    lines.push('# No environment - add your variables here', '${BASE_URL}    http://localhost:8080');
    return lines.join('\n') + '\n';
  }
  for (const v of environment.variables) {
    if (!v.enabled) continue;
    if (v.secret) {
      lines.push(`# ${envVar(v.key)} - stored in OS keychain, never hardcoded`);
    } else {
      lines.push(`${robotVar(v.key)}    ${v.value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Collapse a (pretty-printed) JSON body onto a single line so it occupies one
 * Robot Framework cell. Multi-line JSON written straight after `VAR ${body}` has
 * no `...` continuation, so Robot parses each line as a keyword call. Compact
 * JSON stays valid as one cell (Robot splits cells on 2+ spaces or tabs, which
 * compact JSON does not contain).
 */
function compactJsonBody(json: string): string {
  try { return JSON.stringify(JSON.parse(json)); } catch { return json.replace(/\s*\r?\n\s*/g, ' ').trim(); }
}

/** A JSONPath accessor is nested (not a single top-level key) when it contains `.` or `[`. */
function isNestedPath(jp: string): boolean {
  return /[.[]/.test(jp);
}

/**
 * Convert a JSONPath accessor (`address.street`, `matches[0]`, `users[0].name`,
 * `['my key'].v`) into Python subscripts on the parsed body, e.g.
 * `['address']['street']`, `['matches'][0]`. Used with `Evaluate    $response...`
 * so nested paths work (Robot's `Get From Dictionary` only takes a flat key).
 */
function pyIndex(jp: string): string {
  return jp
    .replaceAll(/\.([A-Za-z_$][\w$]*)/g, "['$1']")
    .replace(/^([A-Za-z_$][\w$]*)/, "['$1']");
}

/**
 * JSONPath extractions use Jayway/jsonpath-plus syntax, which Robot's available
 * JSONPath libraries (jsonpath-ng) do not parse the same way (filters especially).
 * Rather than emit a query that silently resolves wrong, define the variable as
 * empty and point the user at the manual step, keeping the suite runnable.
 */
function jsonPathPlaceholder(name: string, query: string): string[] {
  return [
    `    # JSONPath not auto-translated to Robot: ${query}`,
    `    # Set \${${name}} manually, or use a JSONPath library and adapt the query to jsonpath-ng syntax.`,
    `    VAR    \${${name}}    \${EMPTY}`,
    `    Set Suite Variable    \${${name}}`,
  ];
}

/** Emit `${name}=` read of accessor `jp` out of `${response}` as a string. */
function readJsonValue(name: string, jp: string): string[] {
  if (isNestedPath(jp)) {
    return [`    \${${name}}=    Evaluate    str($response.json()${pyIndex(jp)})`];
  }
  return [`    \${${name}}=    Get From Dictionary    \${response.json()}    ${jp}`];
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

      lines.push(kwName, `    [Documentation]    Hook: ${req.hookType} - ${req.name}`);

      // robotframework-requests has no keyword for QUERY (RFC 10008)
      if (!ROBOT_REQUESTS_METHODS.includes(req.method)) {
        lines.push(`    Log    ${req.method} is not supported by robotframework-requests - hook skipped    WARN`, `    RETURN    \${None}`, '');
        continue;
      }

      // Body
      const { body } = req;
      if (hasBody(req) && body.mode === 'json' && body.json) {
        const bodyPairs = jsonToRfDictPairs(body.json, varMap);
        if (bodyPairs !== null) {
          lines.push(`    VAR    &{body}    ${bodyPairs}`);
        } else {
          lines.push(`    VAR    \${body}    ${interpolate(compactJsonBody(body.json), varMap)}`);
        }
      }

      const callArgs: string[] = [];
      if (hasBody(req) && body.mode === 'json') callArgs.push('json=${body}');

      lines.push(`    \${response}=    ${method}    ${url}`);
      if (callArgs.length) lines.push(`    ...    ${callArgs.join('    ')}`);

      // Extract variables from post-script
      const parsed = parsePostScript(req.postRequestScript);
      for (const e of parsed.extractions) {
        const rfVar = e.varName.replaceAll(/\W+/g, '_').toUpperCase();
        hookExtractedVars.add(rfVar);
        if (e.jsonPath) {
          lines.push(...jsonPathPlaceholder(rfVar, e.jsonPath.query));
        } else {
          lines.push(...readJsonValue(rfVar, accessorToJsonPath(e.accessor)), `    Set Suite Variable    \${${rfVar}}`);
        }
      }

      lines.push(`    RETURN    \${response}`, '');
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

      lines.push(kwName, `    [Documentation]    ${req.description || req.name}`);

      // robotframework-requests has no keyword for QUERY (RFC 10008)
      if (!ROBOT_REQUESTS_METHODS.includes(req.method)) {
        lines.push(`    Log    ${req.method} is not supported by robotframework-requests - request skipped    WARN`, `    RETURN    \${None}`, '');
        continue;
      }

      // ── Collect header pairs (inherited auth + custom) ─────────────────────
      const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
      const effectiveAuth = resolveEffectiveAuth(req, inherited);
      const allHeaders = mergeHeaders(req, inherited);

      const headerPairs: string[] = [];

      if (effectiveAuth.type === 'bearer') {
        const token = effectiveAuth.token ?? '';
        if (token.includes('{{')) {
          // Check if it references a hook-extracted variable
          const varRef = (/\{\{([^}]+)\}\}/.exec(token))?.[1]?.trim();
          const rfVar = varRef ? varRef.replaceAll(/\W+/g, '_').toUpperCase() : '';
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
      if (hasBody(req) && body.mode === 'json' && body.json) {
        const bodyPairs = jsonToRfDictPairs(body.json, varMap);
        if (bodyPairs !== null) {
          lines.push(`    VAR    &{body}    ${bodyPairs}`);
        } else {
          lines.push(`    VAR    \${body}    ${interpolate(compactJsonBody(body.json), varMap)}`);
        }
      }

      // ── HTTP call ───────────────────────────────────────────────────────────
      const method   = req.method.charAt(0) + req.method.slice(1).toLowerCase();
      const callArgs: string[] = [];
      if (headerPairs.length)                    callArgs.push('headers=${headers}');
      if (enabledParams.length)                  callArgs.push('params=${params}');
      if (hasBody(req) && body.mode === 'json')  callArgs.push('json=${body}');

      lines.push(`    \${response}=    ${method}    ${url}`);
      if (callArgs.length) {
        lines.push(`    ...    ${callArgs.join('    ')}`);
      }

      lines.push(`    RETURN    \${response}`, '');
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
  const varMap  = new Map<string, EnvVariable>(
    (environment?.variables ?? []).map(v => [v.key, v])
  );

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
      lines.push(kwName, `    [Documentation]    ${req.description || req.name}`, `    \${response}=    ${kwName}`);

      const parsed = parsePostScript(req.postRequestScript);
      if (parsed.assertions.length > 0) {
        for (const a of parsed.assertions) {
          const jp = accessorToJsonPath(a.accessor);
          switch (a.kind) {
            case 'status':
              lines.push(`    Status Should Be    ${a.expected ?? 200}    \${response}`);
              break;
            case 'equals': {
              const expected = interpolate(a.expected?.replaceAll(/^"|"$/g, '') ?? '', varMap);
              lines.push(...readJsonValue('value', jp), `    Should Be Equal As Strings    \${value}    ${expected}`);
              break;
            }
            case 'contains': {
              const expected = interpolate(a.expected?.replaceAll(/^"|"$/g, '') ?? '', varMap);
              lines.push(...readJsonValue('value', jp), `    Should Contain    \${value}    ${expected}`);
              break;
            }
            case 'exists':
              if (isNestedPath(jp)) {
                lines.push(`    \${value}=    Evaluate    $response.json()${pyIndex(jp)}`, `    Should Not Be Equal    \${value}    \${None}`);
              } else {
                lines.push(`    Dictionary Should Contain Key    \${response.json()}    ${jp}`);
              }
              break;
            default:
              lines.push(`    Status Should Be    200    \${response}`);
          }
        }
      } else {
        lines.push(`    Status Should Be    200    \${response}`);
      }

      for (const e of parsed.extractions) {
        if (e.jsonPath) {
          lines.push(...jsonPathPlaceholder(e.varName, e.jsonPath.query));
        } else {
          lines.push(...readJsonValue(e.varName, accessorToJsonPath(e.accessor)), `    Set Suite Variable    \${${e.varName}}`);
        }
      }

      lines.push('');
    }
    for (const sub of folder.folders) processFolder(sub);
  }

  processFolder(collection.rootFolder);
  return lines.join('\n');
}

// ─── README ───────────────────────────────────────────────────────────────────

function buildReadme(collectionName: string, filePaths: string[]): string {
  const tree = renderTree(filePaths);
  return `# ${collectionName} - API Tests (Robot Framework)

## Project structure

\`\`\`
${tree}
\`\`\`

> Secrets are read from OS environment variables (e.g. \`%{API_TOKEN}\`).
> Never hardcode secrets - export them in your shell or CI environment.

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
  const slug    = collection.name.replaceAll(/\W+/g, '_').toLowerCase();

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
