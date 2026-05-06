// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { parseWsdl, buildEnvelopeTemplate } from '../main/ipc/soap-handler';

// ─── Minimal WSDL fixtures ────────────────────────────────────────────────────

const SIMPLE_WSDL = `
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             targetNamespace="http://example.com/calculator">
  <wsdl:portType name="CalculatorPortType">
    <wsdl:operation name="Add"/>
    <wsdl:operation name="Subtract"/>
  </wsdl:portType>
  <wsdl:binding name="CalculatorBinding" type="tns:CalculatorPortType">
    <wsdl:operation name="Add">
      <soap:operation soapAction="http://example.com/Add"/>
    </wsdl:operation>
    <wsdl:operation name="Subtract">
      <soap:operation soapAction="http://example.com/Subtract"/>
    </wsdl:operation>
  </wsdl:binding>
</definitions>`;

const NO_NAMESPACE_WSDL = `
<definitions>
  <operation name="Ping">
    <soap:operation soapAction="urn:Ping"/>
  </operation>
</definitions>`;

const EMPTY_WSDL = `<definitions targetNamespace="http://empty.example.com"></definitions>`;

// Calculator-style WSDL with full schema + service/port → drives endpoint and
// param-aware envelope generation.
const CALCULATOR_WSDL = `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                  xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
                  xmlns:xs="http://www.w3.org/2001/XMLSchema"
                  xmlns:tns="http://tempuri.org/"
                  targetNamespace="http://tempuri.org/">
  <wsdl:types>
    <xs:schema targetNamespace="http://tempuri.org/" elementFormDefault="qualified">
      <xs:element name="Add">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="intA" type="xs:int"/>
            <xs:element name="intB" type="xs:int"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="AddResponse">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="AddResult" type="xs:int"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="AddSoapIn">
    <wsdl:part name="parameters" element="tns:Add"/>
  </wsdl:message>
  <wsdl:message name="AddSoapOut">
    <wsdl:part name="parameters" element="tns:AddResponse"/>
  </wsdl:message>
  <wsdl:portType name="CalculatorSoap">
    <wsdl:operation name="Add">
      <wsdl:input message="tns:AddSoapIn"/>
      <wsdl:output message="tns:AddSoapOut"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="CalculatorSoap" type="tns:CalculatorSoap">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Add">
      <soap:operation soapAction="http://tempuri.org/Add"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="CalculatorSoap12" type="tns:CalculatorSoap">
    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Add">
      <soap12:operation soapAction="http://tempuri.org/Add"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="Calculator">
    <wsdl:port name="CalculatorSoap" binding="tns:CalculatorSoap">
      <soap:address location="http://www.dneonline.com/calculator.asmx"/>
    </wsdl:port>
    <wsdl:port name="CalculatorSoap12" binding="tns:CalculatorSoap12">
      <soap12:address location="http://www.dneonline.com/calculator.asmx"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

// ─── parseWsdl ────────────────────────────────────────────────────────────────

describe('parseWsdl', () => {
  it('extracts targetNamespace', () => {
    const result = parseWsdl(SIMPLE_WSDL);
    expect(result.targetNamespace).toBe('http://example.com/calculator');
  });

  it('extracts all operation names', () => {
    const result = parseWsdl(SIMPLE_WSDL);
    const names = result.operations.map(o => o.name);
    expect(names).toContain('Add');
    expect(names).toContain('Subtract');
  });

  it('extracts SOAPAction for each operation', () => {
    const result = parseWsdl(SIMPLE_WSDL);
    const add = result.operations.find(o => o.name === 'Add');
    expect(add?.soapAction).toBe('http://example.com/Add');
  });

  it('builds an envelope template for each operation', () => {
    const result = parseWsdl(SIMPLE_WSDL);
    for (const op of result.operations) {
      expect(op.inputTemplate).toContain('<soap:Envelope');
      expect(op.inputTemplate).toContain(op.name);
    }
  });

  it('returns empty operations array for WSDL with no operations', () => {
    const result = parseWsdl(EMPTY_WSDL);
    expect(result.operations).toHaveLength(0);
  });

  it('falls back to empty string when targetNamespace is absent', () => {
    const result = parseWsdl(NO_NAMESPACE_WSDL);
    expect(result.targetNamespace).toBe('');
  });

  it('handles non-prefixed operation tags via the regex fallback', () => {
    const result = parseWsdl(NO_NAMESPACE_WSDL);
    const names = result.operations.map(o => o.name);
    expect(names).toContain('Ping');
  });
});

// ─── buildEnvelopeTemplate ────────────────────────────────────────────────────

describe('buildEnvelopeTemplate', () => {
  it('wraps the operation name in tns namespace', () => {
    const xml = buildEnvelopeTemplate('GetUser', 'http://example.com');
    expect(xml).toContain('<tns:GetUser>');
    expect(xml).toContain('</tns:GetUser>');
  });

  it('includes the provided namespace in xmlns:tns', () => {
    const xml = buildEnvelopeTemplate('Op', 'urn:my-ns');
    expect(xml).toContain('xmlns:tns="urn:my-ns"');
  });

  it('always contains a soap:Body element', () => {
    const xml = buildEnvelopeTemplate('Anything', 'urn:ns');
    expect(xml).toContain('<soap:Body>');
    expect(xml).toContain('</soap:Body>');
  });

  it('starts with an XML declaration', () => {
    const xml = buildEnvelopeTemplate('Op', 'urn:ns');
    expect(xml.trimStart()).toMatch(/^<\?xml/);
  });

  it('works with empty namespace', () => {
    const xml = buildEnvelopeTemplate('Op', '');
    expect(xml).toContain('xmlns:tns=""');
  });

  it('uses SOAP 1.2 envelope namespace when version=1.2', () => {
    const xml = buildEnvelopeTemplate('Op', 'urn:ns', [], '1.2');
    expect(xml).toContain('http://www.w3.org/2003/05/soap-envelope');
  });

  it('emits parameter elements with type hints when params provided', () => {
    const xml = buildEnvelopeTemplate('Add', 'http://tempuri.org/', [
      { name: 'intA', typeHint: 'int' },
      { name: 'intB', typeHint: 'int' },
    ]);
    expect(xml).toContain('<tns:intA><!-- int --></tns:intA>');
    expect(xml).toContain('<tns:intB><!-- int --></tns:intB>');
  });
});

// ─── Schema-aware parsing (calculator fixture) ───────────────────────────────

describe('parseWsdl with schema + service', () => {
  it('extracts the endpoint address from service/port', () => {
    const result = parseWsdl(CALCULATOR_WSDL);
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.endpoints.some(e => e.address === 'http://www.dneonline.com/calculator.asmx')).toBe(true);
  });

  it('detects both SOAP 1.1 and SOAP 1.2 bindings', () => {
    const result = parseWsdl(CALCULATOR_WSDL);
    const versions = new Set(result.operations.map(o => o.soapVersion));
    expect(versions.has('1.1')).toBe(true);
    expect(versions.has('1.2')).toBe(true);
  });

  it('attaches the resolved endpoint to each operation', () => {
    const result = parseWsdl(CALCULATOR_WSDL);
    const add = result.operations.find(o => o.name === 'Add' && o.soapVersion === '1.1');
    expect(add?.endpoint).toBe('http://www.dneonline.com/calculator.asmx');
  });

  it('builds an envelope with the actual input parameters from the schema', () => {
    const result = parseWsdl(CALCULATOR_WSDL);
    const add = result.operations.find(o => o.name === 'Add' && o.soapVersion === '1.1');
    expect(add?.inputTemplate).toContain('<tns:intA>');
    expect(add?.inputTemplate).toContain('<tns:intB>');
    // No more "Add parameters here" placeholder when the schema is resolvable.
    expect(add?.inputTemplate).not.toContain('Add parameters here');
  });

  it('SOAP 1.2 operation uses the soap12 envelope namespace', () => {
    const result = parseWsdl(CALCULATOR_WSDL);
    const add12 = result.operations.find(o => o.name === 'Add' && o.soapVersion === '1.2');
    expect(add12?.inputTemplate).toContain('http://www.w3.org/2003/05/soap-envelope');
  });
});
