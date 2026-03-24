// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

import type { Collection, Environment, Folder, GeneratedFile } from '../../shared/types';

// ─── REST Assured (Java + JUnit 5 + Maven) generator ─────────────────────────

function javaClass(name: string): string {
  return name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function javaMethod(name: string): string {
  const parts = name.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  return parts[0].toLowerCase() + parts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toEnvConst(key: string): string {
  return key.replace(/\W+/g, '_').toUpperCase();
}

/** Replace {{var}} with System.getenv("VAR") ?? "" Java expression. */
function interpolateJava(value: string): string {
  return '"' + value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const envKey = toEnvConst(key.trim());
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

function buildTestClass(folderName: string, folder: Folder, requests: Collection['requests']): string {
  const className = javaClass(folderName) + 'Test';
  const methods: string[] = [];

  // Build unique method names within this class
  const usedNames = new Set<string>();
  const nameMap = new Map<string, string>();
  for (const reqId of folder.requestIds) {
    const req = requests[reqId];
    if (!req) continue;
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
    if (!req) continue;

    const methodName = nameMap.get(reqId)!;
    const method = req.method.toLowerCase();
    const path = req.url
      .replace(/^https?:\/\/[^/]+/, '')   // strip https://host
      .replace(/^\{\{[^}]+\}\}/, '')       // strip leading {{BASE_URL}} placeholder
      || '/';
    const javaPath = interpolateJava(path);
    const enabledHeaders = req.headers.filter(h => h.enabled && h.key);
    const enabledParams  = req.params.filter(p => p.enabled && p.key);
    const hasBody = req.body.mode !== 'none' && !['get', 'head'].includes(method);

    const lines: string[] = [];
    lines.push(`    @Test`);
    lines.push(`    public void ${methodName}() {`);
    lines.push(`        given()`);
    lines.push(`            .spec(requestSpec)`);

    for (const h of enabledHeaders) {
      lines.push(`            .header("${h.key}", ${interpolateJava(h.value)})`);
    }

    for (const p of enabledParams) {
      lines.push(`            .queryParam("${p.key}", ${interpolateJava(p.value)})`);
    }

    if (hasBody) {
      if (req.body.mode === 'json' && req.body.json) {
        // Inline the JSON body as a Java string (escape double quotes)
        const escaped = req.body.json.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        lines.push(`            .body("${escaped}")`);
      }
    }

    lines.push(`        .when()`);
    lines.push(`            .${method}(${javaPath})`);
    lines.push(`        .then()`);
    lines.push(`            .statusCode(200);`);
    lines.push(`            // .body("field", equalTo("value"));`);
    lines.push(`    }`);

    methods.push(lines.join('\n'));
  }

  return `package com.example.api;

import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

public class ${className} extends BaseTest {

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
        content: buildTestClass(name, folder, collection.requests),
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
