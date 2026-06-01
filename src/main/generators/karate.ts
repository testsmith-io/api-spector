// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment, Folder, GeneratedFile, RequestBody } from '../../shared/types';
import { resolveInheritedAuthAndHeaders, getAllApplicableHooks } from '../../shared/request-collection';
import { parsePostScript, accessorToJsonPath } from './script-parser';

// ─── Karate (Java + JUnit 5 + Maven) generator ───────────────────────────────
//
// Emits a runnable Maven project: pom.xml, karate-config.js, a JUnit 5 runner,
// and one .feature file per folder. Variables flow through karate-config.js
// (baseUrl + secrets) and are referenced in feature files as plain JS idents.
// Hooks are translated to Background sections; pre/post-script extractions
// become `* def` lines so subsequent scenarios can reference the captured
// values.
//
// References:
//   https://docs.karatelabs.io/getting-started/why-karate
//   https://github.com/karatelabs/karate

// ─── Identifier helpers ──────────────────────────────────────────────────────

function javaClass(name: string): string {
  return name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** Karate-friendly variable name: lowerCamelCase, JS-safe identifier.
 *  Splits on any non-alphanumeric run (including `_` and `-`) and lowercases
 *  every part so SCREAMING_SNAKE acronyms collapse to `baseUrl`/`authToken`/
 *  `userId` rather than `baseURL`/`authTOKEN`/`userID`. */
function jsVar(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean).map(p => p.toLowerCase());
  if (parts.length === 0) return '_';
  return parts[0] + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** Lowercase, hyphenated file-stem suitable for a `.feature` filename. */
function featureFileName(name: string): string {
  const slug = name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  return slug || 'tests';
}

/** Karate's preferred camelCase config key for an env-variable name. */
function configKey(envKey: string): string {
  return jsVar(envKey);
}

/** Escape characters that would break a single-quoted Karate string. */
function escSingle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Render a `{{var}}`-laced string as a Karate expression in single-quoted
 * concat form: `'foo ' + token + ' bar'`. Pure-literal strings come back
 * fully quoted so they can drop straight into a Karate step.
 */
function interpolateKarate(value: string): string {
  if (!value.includes('{{')) return `'${escSingle(value)}'`;
  const parts: string[] = [];
  let last = 0;
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    if (m.index > last) parts.push(`'${escSingle(value.slice(last, m.index))}'`);
    parts.push(configKey(m[1].trim()));
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push(`'${escSingle(value.slice(last))}'`);
  return parts.length === 1 ? parts[0] : parts.join(' + ');
}

/**
 * Decide how to render a request URL as Karate steps. Three cases:
 *
 *   1. `{{BASE_URL}}/foo/bar` → `Given url baseUrl` + `And path 'foo/bar'`
 *      (any `{{var}}` prefix becomes a config-driven base, with the
 *      remainder split out so query/path interpolation stays clean).
 *   2. `https://api.example.com/foo` → `Given url 'https://api.example.com/foo'`
 *      (literal host means the request is self-sufficient — don't force a
 *      baseUrl the user didn't ask for).
 *   3. `/foo` or `foo` → `Given url baseUrl` + `And path 'foo'`
 *      (relative path: fall back to whatever baseUrl resolves to in
 *      karate-config.js).
 *
 * The returned blocks plug directly into the Scenario builder's `setup`
 * array, so the first one becomes `Given …` and the rest `And …`.
 */
function urlSteps(url: string): string[][] {
  const leadingVar = url.match(/^\{\{([^}]+)\}\}(.*)$/);
  if (leadingVar) {
    const baseVar = configKey(leadingVar[1].trim());
    const rest = leadingVar[2].replace(/^\//, '');
    const steps: string[][] = [[`url ${baseVar}`]];
    if (rest) steps.push([`path ${interpolateKarate(rest)}`]);
    return steps;
  }
  if (/^https?:\/\//i.test(url)) {
    return [[`url ${interpolateKarate(url)}`]];
  }
  const rest = url.replace(/^\//, '');
  const steps: string[][] = [[`url baseUrl`]];
  if (rest) steps.push([`path ${interpolateKarate(rest)}`]);
  return steps;
}

// ─── pom.xml ─────────────────────────────────────────────────────────────────

function buildPom(collectionName: string): string {
  const artifact = collectionName.replace(/\W+/g, '-').toLowerCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example.api</groupId>
  <artifactId>${artifact}-karate</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>jar</packaging>

  <properties>
    <java.version>17</java.version>
    <maven.compiler.source>\${java.version}</maven.compiler.source>
    <maven.compiler.target>\${java.version}</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <karate.version>1.5.0</karate.version>
    <junit.version>5.10.2</junit.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>io.karatelabs</groupId>
      <artifactId>karate-junit5</artifactId>
      <version>\${karate.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>\${junit.version}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

// ─── karate-config.js ────────────────────────────────────────────────────────

function buildKarateConfig(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:8080';

  // Every non-baseUrl env variable becomes a top-level config field. Plain
  // values keep their default; secrets/sensitive values come from
  // System.getenv at runtime so the generated project never embeds them.
  const lines: string[] = [];
  lines.push(`function fn() {`);
  lines.push(`  var env = karate.env || 'dev';`);
  lines.push(`  karate.log('karate env:', env);`);
  lines.push(``);
  lines.push(`  var config = {`);
  lines.push(`    baseUrl: '${escSingle(baseUrl)}'`);

  const otherVars = (environment?.variables ?? []).filter(v => {
    const k = v.key.toLowerCase();
    return v.enabled && !['base_url', 'baseurl', 'base-url'].includes(k);
  });
  for (const v of otherVars) {
    const key = configKey(v.key);
    const def = v.secret ? "''" : `'${escSingle(v.value ?? '')}'`;
    lines.push(`,`);
    lines.push(`    ${key}: ${def}`);
  }
  lines.push(`  };`);
  lines.push(``);
  lines.push(`  // Allow each variable to be overridden via a process env var of the same`);
  lines.push(`  // SHOUTY_SNAKE_CASE name (e.g. AUTH_TOKEN populates config.authToken).`);
  lines.push(`  function envOverride(name, key) {`);
  lines.push(`    var v = java.lang.System.getenv(name);`);
  lines.push(`    if (v) config[key] = v;`);
  lines.push(`  }`);
  lines.push(`  envOverride('BASE_URL', 'baseUrl');`);
  for (const v of otherVars) {
    lines.push(`  envOverride('${v.key}', '${configKey(v.key)}');`);
  }
  lines.push(``);
  lines.push(`  return config;`);
  lines.push(`}`);
  return lines.join('\n') + '\n';
}

// ─── TestRunner.java ─────────────────────────────────────────────────────────

function buildRunner(collectionName: string): string {
  const className = javaClass(collectionName) + 'Runner';
  return `package karate;

import com.intuit.karate.junit5.Karate;

/**
 * JUnit 5 entry point — runs every .feature in the \`karate\` package
 * (this folder). Override the active env at run time with:
 *
 *   mvn test -Dkarate.env=staging
 */
public class ${className} {

    @Karate.Test
    Karate all() {
        return Karate.run().relativeTo(getClass());
    }
}
`;
}

// ─── Per-folder feature file ─────────────────────────────────────────────────

interface BackgroundBlock {
  lines: string[]
  /** Variables defined by hook extractions (so we know not to fall back to
   *  config keys when a Scenario references them). */
  defined: Set<string>
}

function buildBackground(folderId: string, collection: Collection): BackgroundBlock {
  const hooks = getAllApplicableHooks(folderId, collection);
  const lines: string[] = [];
  const defined = new Set<string>();

  // Karate's Background runs once per Scenario. That's not a perfect mapping
  // for `beforeAll`, but it's safe — re-running a token fetch per scenario is
  // wasteful but correct. `callonce` could optimise this; we keep things flat
  // for readability.
  for (const h of [...hooks.beforeAll, ...hooks.before]) {
    const method = h.method.toLowerCase();
    const declared = new Set((h.headers ?? []).filter(x => x.enabled && x.key).map(x => x.key.toLowerCase()));
    const has = (n: string) => declared.has(n.toLowerCase());

    lines.push(`  # ${h.name}`);
    for (const block of urlSteps(h.url)) {
      lines.push(`  * ${block[0]}`);
      for (let i = 1; i < block.length; i++) lines.push(block[i]);
    }
    for (const x of (h.headers ?? []).filter(x => x.enabled && x.key)) {
      lines.push(`  * header ${x.key} = ${interpolateKarate(x.value)}`);
    }
    if (h.body.mode !== 'none' && !['get', 'head'].includes(method)) {
      for (const block of bodySteps(h.body, has)) {
        lines.push(`  * ${block[0]}`);
        for (let i = 1; i < block.length; i++) lines.push(block[i]);
      }
    }
    lines.push(`  * method ${method}`);

    const parsed = parsePostScript(h.postRequestScript);
    for (const e of parsed.extractions) {
      const jp = accessorToJsonPath(e.accessor).replace(/^json\.?/, '');
      const expr = jp ? `response.${jp}` : 'response';
      const name = configKey(e.varName);
      defined.add(name);
      lines.push(`  * def ${name} = ${expr}`);
    }
  }

  return { lines, defined };
}

/**
 * Render a JSON body as a Karate docstring block. `{{var}}` tokens become
 * Karate's `#(var)` placeholder so values still substitute when the JSON is
 * evaluated. Output is pretty-printed and indented under `request`:
 *
 *     """
 *     {
 *       "name": "Karate Demo Post"
 *     }
 *     """
 */
function bodyDocstring(json: string): string[] {
  const expanded = json.replace(/\{\{([^}]+)\}\}/g, (_, k) => `#(${configKey(k.trim())})`);
  let pretty = expanded.trim();
  try {
    pretty = JSON.stringify(JSON.parse(expanded), null, 2);
  } catch {
    // Not strictly-valid JSON (e.g. trailing commas or an unquoted
    // placeholder). Emit the user's text verbatim so Karate can still
    // evaluate it; alignment may be slightly less crisp.
  }
  const out: string[] = ['    """'];
  for (const l of pretty.split('\n')) out.push(`    ${l}`);
  out.push('    """');
  return out;
}

/**
 * Render a raw text/XML/SOAP body as a Karate docstring. No re-formatting —
 * just split on newlines and indent so the original structure (XML
 * namespaces, whitespace-sensitive payloads) survives.
 */
function rawDocstring(text: string): string[] {
  const expanded = text.replace(/\{\{([^}]+)\}\}/g, (_, k) => `#(${configKey(k.trim())})`);
  const out: string[] = ['    """'];
  for (const l of expanded.replace(/\r\n/g, '\n').split('\n')) out.push(`    ${l}`);
  out.push('    """');
  return out;
}

/**
 * Steps required to send an arbitrary request body. Returns one or more
 * "step blocks" (first line + continuation lines) so a multi-line `request`
 * docstring can be rendered with the right Gherkin keyword applied to its
 * first line. Headers added here only fire when the user hasn't already
 * declared them — preserves an explicit override.
 */
function bodySteps(
  body: RequestBody,
  alreadyHasHeader: (name: string) => boolean,
): string[][] {
  if (body.mode === 'json' && body.json) {
    return [[`request`, ...bodyDocstring(body.json)]];
  }
  if (body.mode === 'soap' && body.soap?.envelope) {
    const out: string[][] = [];
    if (body.soap.soapAction && !alreadyHasHeader('soapaction')) {
      // SOAP 1.1 wants the action quoted; double-quote it so Karate emits
      // SOAPAction: "https://…"
      out.push([`header SOAPAction = '"${escSingle(body.soap.soapAction)}"'`]);
    }
    if (!alreadyHasHeader('content-type')) {
      out.push([`header Content-Type = 'text/xml; charset=utf-8'`]);
    }
    out.push([`request`, ...rawDocstring(body.soap.envelope)]);
    return out;
  }
  if (body.mode === 'raw' && body.raw) {
    const out: string[][] = [];
    if (body.rawContentType && !alreadyHasHeader('content-type')) {
      out.push([`header Content-Type = '${escSingle(body.rawContentType)}'`]);
    }
    out.push([`request`, ...rawDocstring(body.raw)]);
    return out;
  }
  if (body.mode === 'graphql' && body.graphql) {
    // GraphQL request shape: { query, variables?, operationName? }. Build
    // the JSON envelope here so consumers don't have to special-case it.
    const env: Record<string, unknown> = { query: body.graphql.query };
    if (body.graphql.variables?.trim()) {
      try { env.variables = JSON.parse(body.graphql.variables); } catch { /* leave undefined */ }
    }
    if (body.graphql.operationName?.trim()) env.operationName = body.graphql.operationName.trim();
    return [[`request`, ...bodyDocstring(JSON.stringify(env))]];
  }
  return [];
}

function buildFeature(folderName: string, folder: Folder, collection: Collection): string {
  const requests = collection.requests;
  const bg = buildBackground(folder.id, collection);

  const scenarios: string[] = [];
  const usedTags = new Set<string>();

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.disabled || req.hookType) continue;

    // Karate scenario tags must be unique-ish to be useful for `--tags`
    // filters; collisions are harmless (multiple scenarios share a tag) but
    // we still try for distinct slugs.
    let tag = featureFileName(req.name);
    if (usedTags.has(tag)) {
      let i = 2;
      while (usedTags.has(`${tag}-${i}`)) i++;
      tag = `${tag}-${i}`;
    }
    usedTags.add(tag);

    const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
    const effectiveAuth = req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
    const allHeaders = [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];
    const enabledParams = req.params.filter(p => p.enabled && p.key);
    const method = req.method.toLowerCase();
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);

    const lines: string[] = [];
    lines.push(`@${tag}`);
    lines.push(`Scenario: ${req.name}`);

    // Setup steps: first one is `Given`, the rest `And`. We collect them as
    // (firstLine, ...continuationLines) tuples so a multi-line `request`
    // docstring can carry its `"""` block under the same logical step.
    const setup: string[][] = [...urlSteps(req.url)];

    if (effectiveAuth.type === 'bearer') {
      const token = effectiveAuth.token ?? '';
      if (token.includes('{{')) {
        const single = token.match(/^\{\{([^}]+)\}\}$/);
        if (single) {
          setup.push([`header Authorization = 'Bearer ' + ${configKey(single[1].trim())}`]);
        } else {
          setup.push([`header Authorization = 'Bearer ' + ${interpolateKarate(token)}`]);
        }
      } else if (effectiveAuth.tokenSecretRef) {
        setup.push([`header Authorization = 'Bearer ' + ${configKey(effectiveAuth.tokenSecretRef)}`]);
      } else if (token) {
        setup.push([`header Authorization = 'Bearer ${escSingle(token)}'`]);
      }
    } else if (effectiveAuth.type === 'basic') {
      const user = effectiveAuth.username ?? '';
      const pass = effectiveAuth.password ?? '';
      setup.push([`configure headers = ({ Authorization: 'Basic ' + java.util.Base64.getEncoder().encodeToString((${interpolateKarate(user)} + ':' + ${interpolateKarate(pass)}).getBytes()) })`]);
    }

    for (const h of allHeaders) {
      setup.push([`header ${h.key} = ${interpolateKarate(h.value)}`]);
    }
    for (const p of enabledParams) {
      setup.push([`param ${p.key} = ${interpolateKarate(p.value)}`]);
    }
    if (hasBody) {
      const declared = new Set(allHeaders.map(h => h.key.toLowerCase()));
      const has = (n: string) => declared.has(n.toLowerCase());
      for (const block of bodySteps(req.body, has)) setup.push(block);
    }

    setup.forEach((step, i) => {
      const kw = i === 0 ? 'Given' : 'And';
      lines.push(`  ${kw} ${step[0]}`);
      for (let j = 1; j < step.length; j++) lines.push(step[j]);
    });

    lines.push(`  When method ${method}`);

    // Assertions: first one is `Then`, the rest `And`. We always emit a
    // status assertion (defaulting to 200) so the scenario is meaningfully
    // testing something even when the post-script had no parsed checks.
    const asserts: string[] = [];
    const parsed = parsePostScript(req.postRequestScript);
    let statusEmitted = false;
    if (parsed.assertions.length > 0) {
      for (const a of parsed.assertions) {
        const jp = accessorToJsonPath(a.accessor).replace(/^json\.?/, '');
        const target = jp ? `response.${jp}` : 'response';
        switch (a.kind) {
          case 'status':
            asserts.push(`status ${a.expected ?? 200}`);
            statusEmitted = true;
            break;
          case 'equals':
            asserts.push(`match ${target} == ${a.expected}`);
            break;
          case 'contains':
            asserts.push(`match ${target} contains ${a.expected}`);
            break;
          case 'exists':
            asserts.push(`match ${target} != null`);
            break;
          case 'type': {
            const t = (a.expected ?? '').replace(/"/g, '');
            const fuzzy = ['string', 'number', 'boolean', 'array', 'object'].includes(t)
              ? `'#${t}'`
              : `'#notnull'`;
            asserts.push(`match ${target} == ${fuzzy}`);
            break;
          }
          case 'above':
            asserts.push(`match ${target} > ${a.expected ?? 0}`);
            break;
        }
      }
    }
    if (!statusEmitted) asserts.unshift(`status 200`);

    asserts.forEach((step, i) => {
      const kw = i === 0 ? 'Then' : 'And';
      lines.push(`  ${kw} ${step}`);
    });

    scenarios.push(lines.join('\n'));
  }

  const bgBlock = bg.lines.length > 0
    ? `\nBackground:\n${bg.lines.join('\n')}\n`
    : '';

  return `Feature: ${folderName}
${bgBlock}
${scenarios.join('\n\n')}
`;
}

// ─── README ──────────────────────────────────────────────────────────────────

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
  return `# ${collectionName} — API Tests (Karate + JUnit 5)

Karate is a BDD-flavoured API test framework that uses Gherkin feature files
(no glue code) — see https://docs.karatelabs.io for the full reference.

## Project structure

\`\`\`
${tree}
\`\`\`

## Setup

Requires Java 17+ and Maven 3.8+.

\`\`\`sh
# Run all features
mvn test

# Switch environment (read by karate-config.js)
mvn test -Dkarate.env=staging

# Override individual values
BASE_URL=https://api.example.com AUTH_TOKEN=eyJ... mvn test

# Filter by tag
mvn test "-Dkarate.options=--tags @get-users"
\`\`\`
`;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function generateKarate(
  collection: Collection,
  environment: Environment | null
): GeneratedFile[] {
  // Standard Maven layout — Java sources under src/test/java, every other
  // resource (karate-config.js, *.feature) under src/test/resources. With
  // `relativeTo(getClass())` the runner resolves features by package, so as
  // long as the runner sits at `karate/` and the features at the matching
  // resources path, Maven copies them onto the test classpath at the same
  // location and Karate finds them automatically. This layout keeps every
  // IDE happy without needing a custom <testResources> override in pom.xml.
  const files: GeneratedFile[] = [
    { path: 'pom.xml',                                  content: buildPom(collection.name) },
    { path: 'src/test/resources/karate-config.js',      content: buildKarateConfig(environment) },
    { path: `src/test/java/karate/${javaClass(collection.name)}Runner.java`,
      content: buildRunner(collection.name) },
  ];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.some(id => {
      const r = collection.requests[id];
      return r && !r.disabled && !r.hookType;
    })) {
      files.push({
        path: `src/test/resources/karate/${featureFileName(name)}.feature`,
        content: buildFeature(name, folder, collection),
      });
    }
    for (const sub of folder.folders) processFolder(sub, sub.name);
  }

  if (collection.rootFolder.requestIds.length > 0) {
    processFolder(collection.rootFolder, collection.name);
  }
  for (const sub of collection.rootFolder.folders) processFolder(sub, sub.name);

  files.unshift({ path: 'README.md', content: buildReadme(collection.name, files.map(f => f.path)) });
  return files;
}
