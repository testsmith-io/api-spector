// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment, Folder, GeneratedFile } from '../../shared/types';
import { resolveInheritedAuthAndHeaders, getAllApplicableHooks } from '../../shared/request-collection';
import { parsePostScript, accessorToJsonPath } from './script-parser';

// ─── REST Assured (Java + JUnit 5 + Maven) generator ─────────────────────────

function javaClass(name: string): string {
  return name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function javaMethod(name: string): string {
  const parts = name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  return parts[0].toLowerCase() + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function javaTypeFor(expected?: string): string {
  switch (expected?.replace(/"/g, '')) {
    case 'string':  return 'String.class';
    case 'number':  return 'Number.class';
    case 'boolean': return 'Boolean.class';
    default:        return 'Object.class';
  }
}

function toEnvConst(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

/** Replace {{var}} with System.getenv("VAR") ?? "" Java expression. */
/**
 * Render a string with `{{var}}` tokens as a Java string concatenation.
 * Variables in `sharedVars` (extracted by hooks) reference the local field;
 * everything else falls back to `System.getenv("VAR")`.
 */
function interpolateJava(value: string, sharedVars: Set<string> = new Set()): string {
  return '"' + value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const envKey = toEnvConst(key.trim());
    if (sharedVars.has(envKey)) {
      return `" + ${envKey} + "`;
    }
    return `" + System.getenv("${envKey}") + "`;
  }) + '"';
}

// ─── pom.xml ──────────────────────────────────────────────────────────────────

function buildPom(collectionName: string): string {
  const artifact = collectionName.replace(/\W+/g, '-').toLowerCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example.api</groupId>
  <artifactId>${artifact}-tests</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>jar</packaging>

  <properties>
    <java.version>17</java.version>
    <maven.compiler.source>\${java.version}</maven.compiler.source>
    <maven.compiler.target>\${java.version}</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <rest-assured.version>5.4.0</rest-assured.version>
    <junit.version>5.10.2</junit.version>
  </properties>

  <dependencies>
    <!-- REST Assured -->
    <dependency>
      <groupId>io.rest-assured</groupId>
      <artifactId>rest-assured</artifactId>
      <version>\${rest-assured.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>io.rest-assured</groupId>
      <artifactId>json-schema-validator</artifactId>
      <version>\${rest-assured.version}</version>
      <scope>test</scope>
    </dependency>

    <!-- JUnit 5 -->
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>\${junit.version}</version>
      <scope>test</scope>
    </dependency>

    <!-- Hamcrest -->
    <dependency>
      <groupId>org.hamcrest</groupId>
      <artifactId>hamcrest</artifactId>
      <version>2.2</version>
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

// ─── BaseTest.java ────────────────────────────────────────────────────────────

function buildBaseTest(environment: Environment | null): string {
  const baseUrl = environment?.variables.find(
    v => ['base_url', 'baseurl', 'base-url'].includes(v.key.toLowerCase()) && !v.secret
  )?.value ?? 'http://localhost:8080';

  const secretVars = environment?.variables.filter(v => v.secret && v.secretRef) ?? [];
  const secretComments = secretVars.map(v =>
    `     * - ${toEnvConst(v.key)}=<value from keychain>`
  ).join('\n');

  return `package com.example.api;

import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import org.junit.jupiter.api.BeforeAll;

/**
 * Base class for all API tests.
 *
 * Set the following environment variables before running:
${secretComments ? secretComments + '\n' : ''} * - BASE_URL (optional, default: ${baseUrl})
 */
public class BaseTest {

    protected static RequestSpecification requestSpec;

    @BeforeAll
    static void setupRestAssured() {
        String baseUrl = System.getenv("BASE_URL") != null
            ? System.getenv("BASE_URL")
            : "${baseUrl}";

        requestSpec = new RequestSpecBuilder()
            .setBaseUri(baseUrl)
            .setContentType(ContentType.JSON)
            .setAccept(ContentType.JSON)
            .build();

        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
    }
}
`;
}

// ─── Per-folder test class ────────────────────────────────────────────────────

function buildTestClass(folderName: string, folder: Folder, collection: Collection): string {
  const requests = collection.requests;
  const className = javaClass(folderName) + 'Test';
  const methods: string[] = [];

  // Hook methods (collected from this folder + all ancestors) with variable extraction
  const hooks = getAllApplicableHooks(folder.id, collection);
  const beforeAllH = hooks.beforeAll;
  const afterAllH  = hooks.afterAll;
  const sharedVars = new Set<string>();

  function buildJavaHookLines(h: typeof beforeAllH[0]): string[] {
    const lines: string[] = [`        // ${h.name}`];
    const method = h.method.toLowerCase();
    const path = h.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\{\{[^}]+\}\}/, '') || '/';
    const parsed = parsePostScript(h.postRequestScript);
    if (parsed.extractions.length > 0) {
      lines.push(`        var hookResponse = given().spec(requestSpec)`);
      if (h.body.mode === 'json' && h.body.json) {
        const escaped = h.body.json.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        lines.push(`            .body("${escaped}")`);
      }
      lines.push(`            .when().${method}("${path}");`);
      for (const e of parsed.extractions) {
        const jp = accessorToJsonPath(e.accessor);
        const varName = toEnvConst(e.varName);
        sharedVars.add(varName);
        lines.push(`        ${varName} = hookResponse.jsonPath().getString("${jp}");`);
      }
    } else {
      lines.push(`        given().spec(requestSpec).when().${method}("${path}");`);
    }
    return lines;
  }

  if (beforeAllH.length) {
    const lines = beforeAllH.flatMap(buildJavaHookLines);
    methods.push(`    @BeforeAll\n    static void beforeAll() {\n${lines.join('\n')}\n    }`);
  }
  if (afterAllH.length) {
    const lines = afterAllH.flatMap(buildJavaHookLines);
    methods.push(`    @AfterAll\n    static void afterAll() {\n${lines.join('\n')}\n    }`);
  }

  // Build unique method names within this class
  const usedNames = new Set<string>();
  const nameMap = new Map<string, string>();
  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.disabled || req.hookType) continue;
    const base = javaMethod(req.name);
    let name = base;
    if (usedNames.has(name)) {
      let i = 2;
      while (usedNames.has(`${base}${i}`)) i++;
      name = `${base}${i}`;
    }
    usedNames.add(name);
    nameMap.set(reqId, name);
  }

  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req || req.disabled || req.hookType) continue;

    const methodName = nameMap.get(reqId)!;
    const method = req.method.toLowerCase();
    const path = req.url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\{\{[^}]+\}\}/, '')
      || '/';
    const javaPath = interpolateJava(path, sharedVars);

    // Inherited auth + headers
    const inherited = resolveInheritedAuthAndHeaders(reqId, collection);
    const effectiveAuth = req.auth.type !== 'none' ? req.auth : (inherited.auth ?? req.auth);
    const allHeaders = [...inherited.headers.filter(h => h.enabled && h.key), ...req.headers.filter(h => h.enabled && h.key)];
    const enabledParams = req.params.filter(p => p.enabled && p.key);
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);

    const lines: string[] = [];
    lines.push(`    @Test`);
    lines.push(`    public void ${methodName}() {`);
    lines.push(`        given()`);
    lines.push(`            .spec(requestSpec)`);

    // Auth header — use shared variable if extracted by a hook
    if (effectiveAuth.type === 'bearer') {
      const token = effectiveAuth.token ?? '';
      if (token.includes('{{')) {
        // Check if any referenced var comes from a hook extraction
        const varRef = token.match(/\{\{([^}]+)\}\}/)?.[1]?.trim();
        const envKey = varRef ? toEnvConst(varRef) : '';
        if (envKey && sharedVars.has(envKey)) {
          lines.push(`            .header("Authorization", "Bearer " + ${envKey})`);
        } else {
          lines.push(`            .header("Authorization", "Bearer " + ${interpolateJava(token, sharedVars)})`);
        }
      } else {
        lines.push(`            .header("Authorization", "Bearer " + System.getenv("${toEnvConst(effectiveAuth.tokenSecretRef ?? 'API_TOKEN')}"))`);
      }
    }

    for (const h of allHeaders) {
      lines.push(`            .header("${h.key}", ${interpolateJava(h.value, sharedVars)})`);
    }

    for (const p of enabledParams) {
      lines.push(`            .queryParam("${p.key}", ${interpolateJava(p.value, sharedVars)})`);
    }

    if (hasBody) {
      if (req.body.mode === 'json' && req.body.json) {
        // Inline the JSON body as a Java string. Escape quotes/newlines and
        // interpolate {{var}} tokens into shared-var references or getenv calls.
        const escaped = req.body.json.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        lines.push(`            .body(${interpolateJava(escaped, sharedVars)})`);
      }
    }

    lines.push(`        .when()`);
    lines.push(`            .${method}(${javaPath})`);
    lines.push(`        .then()`);

    const parsed = parsePostScript(req.postRequestScript);
    if (parsed.assertions.length > 0) {
      for (const a of parsed.assertions) {
        const jp = accessorToJsonPath(a.accessor);
        switch (a.kind) {
          case 'status':
            lines.push(`            .statusCode(${a.expected ?? 200})`);
            break;
          case 'equals':
            if (a.expected?.startsWith('"')) {
              lines.push(`            .body("${jp}", equalTo(${a.expected}))`);
            } else {
              lines.push(`            .body("${jp}", equalTo(${a.expected}))`);
            }
            break;
          case 'contains':
            lines.push(`            .body("${jp}", containsString(${a.expected}))`);
            break;
          case 'exists':
            lines.push(`            .body("${jp}", notNullValue())`);
            break;
          case 'type':
            lines.push(`            .body("${jp}", instanceOf(${javaTypeFor(a.expected)}))`);
            break;
          case 'above':
            lines.push(`            .body("${jp}", greaterThan(${a.expected}))`);
            break;
        }
      }
      // End the chain
      lines[lines.length - 1] += ';';
    } else {
      lines.push(`            .statusCode(200);`);
    }

    lines.push(`    }`);

    methods.push(lines.join('\n'));
  }

  const hasHooks = beforeAllH.length > 0 || afterAllH.length > 0;
  const fieldDecls = Array.from(sharedVars).map(v => `    private static String ${v} = "";`).join('\n');
  return `package com.example.api;

import org.junit.jupiter.api.Test;
${hasHooks ? 'import org.junit.jupiter.api.BeforeAll;\nimport org.junit.jupiter.api.AfterAll;\n' : ''}
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

public class ${className} extends BaseTest {
${fieldDecls ? '\n' + fieldDecls + '\n' : ''}

${methods.join('\n\n')}
}
`;
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
  return `# ${collectionName} — API Tests (REST Assured + JUnit 5)

## Project structure

\`\`\`
${tree}
\`\`\`

## Setup

Requires Java 17+ and Maven 3.8+.

\`\`\`sh
# Run all tests
mvn test

# Pass secrets as env vars
BASE_URL=https://api.example.com mvn test
\`\`\`
`;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function generateRestAssured(
  collection: Collection,
  environment: Environment | null
): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: 'pom.xml',                                        content: buildPom(collection.name) },
    { path: 'src/test/java/com/example/api/BaseTest.java',   content: buildBaseTest(environment) },
  ];

  function processFolder(folder: Folder, name: string) {
    if (folder.requestIds.length > 0) {
      const className = javaClass(name) + 'Test';
      files.push({
        path: `src/test/java/com/example/api/${className}.java`,
        content: buildTestClass(name, folder, collection),
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

  files.unshift({ path: 'README.md', content: buildReadme(collection.name, files.map(f => f.path)) });

  return files;
}
