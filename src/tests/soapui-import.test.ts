// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { importSoapUiProject } from '../main/importers/soapui';

// A compact but representative SoapUI project: properties, suite/case, setup
// script, REST request with assertions, Groovy step, SOAP request, transfer step.
const PROJECT = `<?xml version="1.0" encoding="UTF-8"?>
<con:soapui-project name="Orders API" xmlns:con="http://eviware.com/soapui/config">
  <con:properties>
    <con:property><con:name>baseUrl</con:name><con:value>https://api.example.com</con:value></con:property>
  </con:properties>
  <con:testSuite name="Orders">
    <con:testCase name="Create order">
      <con:setupScript><script>log.info("setup starting")</script></con:setupScript>
      <con:testStep type="restrequest" name="Create">
        <con:config>
          <con:restRequest name="Create">
            <con:method>POST</con:method>
            <con:endpoint>https://api.example.com</con:endpoint>
            <con:resourcePath>/orders</con:resourcePath>
            <con:request>{"item":"book"}</con:request>
            <con:assertion type="Script Assertion" name="Status ok">
              <con:configuration>
                <scriptText>def json = new JsonSlurper().parseText(messageExchange.responseContent)
assert json.id != null : "missing id"</scriptText>
              </con:configuration>
            </con:assertion>
            <con:assertion type="Valid HTTP Status Codes" name="200s">
              <con:configuration><codes>200,201</codes></con:configuration>
            </con:assertion>
          </con:restRequest>
        </con:config>
      </con:testStep>
      <con:testStep type="groovy" name="Extract id">
        <con:config><script>def id = context.expand('\${#TestCase#orderId}')
log.info("order " + id)</script></con:config>
      </con:testStep>
      <con:testStep type="request" name="Legacy SOAP">
        <con:config>
          <con:request name="Legacy SOAP">
            <con:endpoint>https://soap.example.com/svc</con:endpoint>
            <con:request>&lt;soap:Envelope/&gt;</con:request>
          </con:request>
        </con:config>
      </con:testStep>
      <con:testStep type="transfer" name="Move token"/>
    </con:testCase>
  </con:testSuite>
</con:soapui-project>`;

describe('importSoapUiProject', () => {
  const result = importSoapUiProject(PROJECT);

  it('names the collection and captures project properties as collection variables', () => {
    expect(result.collection.name).toBe('Orders API');
    expect(result.collection.collectionVariables).toMatchObject({ baseUrl: 'https://api.example.com' });
  });

  it('nests test suite and test case as folders', () => {
    const suite = result.collection.rootFolder.folders.find(f => f.name === 'Orders');
    expect(suite).toBeTruthy();
    const tc = suite!.folders.find(f => f.name === 'Create order');
    expect(tc).toBeTruthy();
  });

  it('builds a REST request with method, URL, body and converted Script Assertion', () => {
    const create = Object.values(result.collection.requests).find(r => r.name === 'Create')!;
    expect(create.method).toBe('POST');
    expect(create.url).toBe('https://api.example.com/orders');
    expect(create.body.mode).toBe('raw');
    expect(create.postRequestScript).toContain('JSON.parse(sp.response.text())');
    expect(create.postRequestScript).toContain('sp.expect(json.id != null).to.be.ok;');
  });

  it('warns about a non-Script assertion rather than dropping it silently', () => {
    expect(result.report.warnings.some(w => /Valid HTTP Status Codes/.test(w))).toBe(true);
  });

  it('imports a standalone Groovy step as a script-carrier request', () => {
    const step = Object.values(result.collection.requests).find(r => r.name === 'Extract id')!;
    expect(step.meta?.tags).toContain('soapui-script');
    expect(step.postRequestScript).toContain('sp.variables.get("orderId")');
  });

  it('imports a SOAP request step with the soap protocol', () => {
    const soap = Object.values(result.collection.requests).find(r => r.name === 'Legacy SOAP')!;
    expect(soap.protocol).toBe('soap');
    expect(soap.url).toBe('https://soap.example.com/svc');
  });

  it('imports a case-level setup script as a carrier', () => {
    const setup = Object.values(result.collection.requests).find(r => /setup/i.test(r.name))!;
    expect(setup).toBeTruthy();
    expect(setup.postRequestScript).toContain('console.log(');
  });

  it('flags the unsupported Property Transfer step', () => {
    expect(result.report.warnings.some(w => /Property Transfer|transfer/i.test(w))).toBe(true);
  });

  it('reports script conversion counts', () => {
    // setup + script-assertion + groovy-step = 3 Groovy artefacts converted.
    expect(result.report.scripts.total).toBe(3);
    expect(result.candidates).toHaveLength(3);
    expect(result.report.testSuites).toBe(1);
    expect(result.report.testCases).toBe(1);
    expect(result.report.requests).toBe(2); // REST + SOAP
  });
});

// Mirrors the structure of real SoapUI 5.x exports: the HTTP verb lives on the
// interface <con:method>, and the test step references it via config attributes
// (methodName / resourcePath) rather than child elements.
describe('importSoapUiProject — real export structure', () => {
  const INTERFACE = `
    <con:interface xsi:type="con:RestService" name="svc" type="rest">
      <con:endpoints><con:endpoint>https://api.example.com</con:endpoint></con:endpoints>
      <con:resource name="users" path="/users">
        <con:method name="List users" method="GET">
          <con:parameters><con:parameter><con:name>page</con:name><con:style>QUERY</con:style></con:parameter></con:parameters>
        </con:method>
        <con:method name="Create user" method="POST"/>
      </con:resource>
    </con:interface>`;

  it('resolves verb + path from the interface method referenced by the step config', () => {
    const xml = `<con:soapui-project name="RS" xmlns:con="http://eviware.com/soapui/config">
      ${INTERFACE}
      <con:testSuite name="TS"><con:testCase name="TC">
        <con:testStep type="restrequest" name="Create">
          <con:config service="svc" resourcePath="/users" methodName="Create user">
            <con:restRequest name="Create"><con:endpoint>https://api.example.com</con:endpoint><con:request/></con:restRequest>
          </con:config>
        </con:testStep>
      </con:testCase></con:testSuite>
    </con:soapui-project>`;
    const r = importSoapUiProject(xml);
    // A test step exists, so interface definitions are NOT also imported.
    expect(r.report.requests).toBe(1);
    const create = Object.values(r.collection.requests)[0];
    expect(create.method).toBe('POST'); // resolved via methodName -> interface
    expect(create.url).toBe('https://api.example.com/users');
  });

  it('falls back to importing interface definitions when there are no test steps', () => {
    const xml = `<con:soapui-project name="Defs" xmlns:con="http://eviware.com/soapui/config">${INTERFACE}</con:soapui-project>`;
    const r = importSoapUiProject(xml);
    expect(r.report.requests).toBe(2);
    const list = Object.values(r.collection.requests).find(q => q.name === 'List users')!;
    expect(list.method).toBe('GET');
    expect(list.url).toBe('https://api.example.com/users');
    expect(list.params.map(p => p.key)).toContain('page');
    const create = Object.values(r.collection.requests).find(q => q.name === 'Create user')!;
    expect(create.method).toBe('POST');
  });

  it('warns when a request declares SoapUI auth, and when nothing is importable', () => {
    const authed = `<con:soapui-project name="A" xmlns:con="http://eviware.com/soapui/config">
      <con:testSuite name="TS"><con:testCase name="TC">
        <con:testStep type="restrequest" name="Secure">
          <con:config resourcePath="/me">
            <con:restRequest name="Secure"><con:endpoint>https://api.example.com</con:endpoint>
              <con:request/><con:credentials><con:authType>OAuth 2.0</con:authType></con:credentials>
            </con:restRequest>
          </con:config>
        </con:testStep>
      </con:testCase></con:testSuite>
    </con:soapui-project>`;
    expect(importSoapUiProject(authed).report.warnings.some(w => /OAuth 2\.0/.test(w))).toBe(true);

    const empty = `<con:soapui-project name="E" xmlns:con="http://eviware.com/soapui/config"><con:settings/></con:soapui-project>`;
    expect(importSoapUiProject(empty).report.warnings.some(w => /No requests or scripts/.test(w))).toBe(true);
  });
});
