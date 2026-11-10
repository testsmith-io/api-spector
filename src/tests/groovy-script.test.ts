// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { convertGroovyScript } from '../main/importers/groovy-script';

// Assert the converted output at least parses as JavaScript (no syntax errors).
function parses(js: string): boolean {
  try { new Function(js); return true; } catch { return false; }
}

describe('convertGroovyScript — API surface', () => {
  it('maps log.* to console.*', () => {
    const r = convertGroovyScript('log.info("hi")\nlog.warn("w")\nlog.error("e")');
    expect(r.js).toContain('console.log("hi")');
    expect(r.js).toContain('console.warn("w")');
    expect(r.js).toContain('console.error("e")');
    expect(r.status).toBe('clean');
  });

  it('maps println (with and without parens) to console.log', () => {
    const r = convertGroovyScript('println "a"\nprintln("b")');
    expect(r.js).toContain('console.log("a")');
    expect(r.js).toContain('console.log("b")');
  });

  it('maps paren-free Groovy log calls (with a GString) to console.*', () => {
    const r = convertGroovyScript('log.info "x is $x"\nlog.warn "careful"');
    expect(r.js).toContain('console.log(`x is ${x}`)');
    expect(r.js).toContain('console.warn("careful")');
  });

  it('maps messageExchange.responseHeaders.get to sp.response.headers.get', () => {
    const r = convertGroovyScript('def ct = messageExchange.responseHeaders.get("Content-Type")');
    expect(r.js).toContain('sp.response.headers.get("Content-Type")');
  });

  it('maps JsonSlurper.parseText to JSON.parse and JsonOutput.toJson to JSON.stringify', () => {
    const r = convertGroovyScript(
      'def j = new groovy.json.JsonSlurper().parseText(messageExchange.responseContent)\n'
      + 'def s = groovy.json.JsonOutput.toJson(j)',
    );
    expect(r.js).toContain('JSON.parse(sp.response.text())');
    expect(r.js).toContain('JSON.stringify(j)');
    expect(r.js).toContain('let j =');
    expect(r.js).toContain('let s =');
  });

  it('maps messageExchange response content to sp.response.text()', () => {
    const r = convertGroovyScript('def body = messageExchange.responseContent');
    expect(r.js).toContain('let body = sp.response.text()');
  });

  it('maps static context.expand tokens to the right sp.* scope', () => {
    const r = convertGroovyScript(
      "def a = context.expand('${#TestCase#token}')\n"
      + "def b = context.expand('${#Env#baseUrl}')\n"
      + "def c = context.expand('${#Global#apiKey}')",
    );
    expect(r.js).toContain("sp.variables.get(\"token\")");
    expect(r.js).toContain("sp.environment.get(\"baseUrl\")");
    expect(r.js).toContain("sp.globals.get(\"apiKey\")");
  });

  it('converts .toInteger()/.toDouble() to parseInt/parseFloat', () => {
    const r = convertGroovyScript('def n = value.toInteger()\ndef d = price.toDouble()');
    expect(r.js).toContain('parseInt(value, 10)');
    expect(r.js).toContain('parseFloat(price)');
  });
});

describe('convertGroovyScript — language idioms', () => {
  it('converts assert to sp.expect(...).to.be.ok', () => {
    const r = convertGroovyScript('assert response.status == 200');
    expect(r.js).toContain('sp.expect(response.status == 200).to.be.ok;');
  });

  it('keeps an assert message as a trailing comment and ignores ternary colons', () => {
    const r = convertGroovyScript("assert count > 0 : 'must have rows'");
    expect(r.js).toContain('sp.expect(count > 0).to.be.ok;');
    expect(r.js).toContain('// must have rows');

    const t = convertGroovyScript('assert (ok ? a : b)');
    expect(t.js).toContain('sp.expect((ok ? a : b)).to.be.ok;');
    expect(t.js).not.toContain('//');
  });

  it('converts double-quoted GStrings to template literals', () => {
    const r = convertGroovyScript('def u = "Bearer ${token} for $name"');
    expect(r.js).toContain('`Bearer ${token} for ${name}`');
  });

  it('converts triple-quoted strings to template literals and leaves single quotes literal', () => {
    const r = convertGroovyScript('def body = """{"id": ${id}}"""\ndef lit = \'raw ${x}\'');
    expect(r.js).toContain('`{"id": ${id}}`');
    expect(r.js).toContain("'raw ${x}'"); // single-quoted stays literal
  });

  it('converts Elvis to || with a note', () => {
    const r = convertGroovyScript('def name = input ?: "anon"');
    expect(r.js).toContain('input || "anon"');
    expect(r.notes.join(' ')).toMatch(/Elvis/);
  });

  it('converts a slashy ==~ regex match to RegExp.test()', () => {
    const r = convertGroovyScript('def ok = email ==~ /.+@.+/');
    expect(r.js).toContain('/.+@.+/.test(email)');
  });

  it('converts for (x in list) to for (const x of list)', () => {
    const r = convertGroovyScript('for (item in items) { log.info(item) }');
    expect(r.js).toContain('for (const item of items)');
  });
});

describe('convertGroovyScript — closures', () => {
  it('converts .each to forEach with an explicit param', () => {
    const r = convertGroovyScript('items.each { item -> log.info(item) }');
    // One-liner closures become expression-bodied arrows (valid and tidy).
    expect(r.js).toContain('items.forEach((item) => console.log(item))');
  });

  it('converts .each with implicit it', () => {
    const r = convertGroovyScript('items.each { log.info(it) }');
    expect(r.js).toContain('items.forEach((it) => console.log(it))');
  });

  it('uses a block body for multi-statement closures', () => {
    const r = convertGroovyScript('items.each { item ->\n  log.info(item)\n  check(item)\n}');
    expect(r.js).toContain('items.forEach((item) => {');
  });

  it('converts .collect single-expression body to .map keeping the return', () => {
    const r = convertGroovyScript('def names = users.collect { it.name }');
    expect(r.js).toContain('users.map((it) => it.name)');
  });

  it('converts .findAll to filter and .find to find', () => {
    const r = convertGroovyScript('def a = xs.findAll { it > 1 }\ndef b = xs.find { it == 2 }');
    expect(r.js).toContain('xs.filter((it) => it > 1)');
    expect(r.js).toContain('xs.find((it) => it == 2)');
  });
});

describe('convertGroovyScript — unsupported constructs', () => {
  it('flags XmlSlurper and records it in unmapped', () => {
    const r = convertGroovyScript('def xml = new XmlSlurper().parseText(body)');
    expect(r.js).toContain('TODO[soapui]');
    expect(r.unmapped.length).toBeGreaterThan(0);
    expect(r.unmapped[0].line).toBe(1);
    expect(r.status).not.toBe('clean');
  });

  it('flags testRunner model navigation', () => {
    const r = convertGroovyScript('def step = testRunner.testCase.testSteps["Login"]');
    expect(r.js).toContain('TODO[soapui]');
    expect(r.unmapped.some(u => /testRunner/.test(u.reason) || /test-model/.test(u.reason))).toBe(true);
  });

  it('does not flag legitimate JS constructors (new Date / new RegExp)', () => {
    const r = convertGroovyScript('def d = new Date()\ndef re = new RegExp("x")');
    expect(r.js).not.toContain('TODO[soapui]');
  });

  it('comments out Groovy imports', () => {
    const r = convertGroovyScript('import groovy.json.JsonSlurper\nlog.info("x")');
    expect(r.js).toContain('// (removed) import groovy.json.JsonSlurper');
  });
});

describe('convertGroovyScript — end to end', () => {
  it('converts a realistic Script Assertion to runnable sp.* JS', () => {
    const src = [
      'import groovy.json.JsonSlurper',
      'def json = new JsonSlurper().parseText(messageExchange.responseContent)',
      'log.info("got ${json.items.size()} items")',
      'assert json.status == "ok" : "bad status"',
      'json.items.each { item ->',
      '  assert item.id != null',
      '}',
    ].join('\n');
    const r = convertGroovyScript(src);

    expect(r.js).toContain('JSON.parse(sp.response.text())');
    expect(r.js).toContain('console.log(`got ${json.items.size()} items`)');
    expect(r.js).toContain('sp.expect(json.status == "ok").to.be.ok;');
    expect(r.js).toContain('json.items.forEach((item) => {');
    expect(parses(r.js)).toBe(true);
    // No hard blockers in this script -> fully or mostly mapped.
    expect(r.status === 'clean' || r.status === 'partial').toBe(true);
    expect(r.unmapped).toHaveLength(0);
  });

  it('produces syntactically valid JS for a clean script', () => {
    const r = convertGroovyScript('def x = 1\nlog.info("x is ${x}")\nassert x == 1');
    expect(parses(r.js)).toBe(true);
    expect(r.status).toBe('clean');
  });
});
