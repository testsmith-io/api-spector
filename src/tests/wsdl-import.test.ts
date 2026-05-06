// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { describe, it, expect } from 'vitest';
import { importWsdl, buildRequestsFromWsdl, buildMockFromWsdl } from '../main/wsdl/import';
import { parseWsdl } from '../main/ipc/soap-handler';
import { SOAP_11_CONTENT_TYPE, SOAP_12_CONTENT_TYPE } from '../shared/soap';

const CALCULATOR_WSDL = `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
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
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="AddSoapIn">
    <wsdl:part name="parameters" element="tns:Add"/>
  </wsdl:message>
  <wsdl:portType name="CalculatorSoap">
    <wsdl:operation name="Add">
      <wsdl:input message="tns:AddSoapIn"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="CalculatorSoap" type="tns:CalculatorSoap">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Add">
      <soap:operation soapAction="http://tempuri.org/Add"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="Calculator">
    <wsdl:port name="CalculatorSoap" binding="tns:CalculatorSoap">
      <soap:address location="http://www.dneonline.com/calculator.asmx"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

describe('buildRequestsFromWsdl', () => {
  it('produces one POST request per operation, fully wired', () => {
    const parsed = parseWsdl(CALCULATOR_WSDL);
    const reqs   = buildRequestsFromWsdl(parsed);
    expect(reqs).toHaveLength(1);
    const add = reqs[0];
    expect(add.method).toBe('POST');
    expect(add.protocol).toBe('soap');
    expect(add.url).toBe('http://www.dneonline.com/calculator.asmx');
    expect(add.body.mode).toBe('soap');
    expect(add.body.soap?.operationName).toBe('Add');
    expect(add.body.soap?.soapAction).toBe('http://tempuri.org/Add');
    expect(add.body.soap?.envelope).toContain('<tns:intA>');
  });

  it('attaches a Content-Type header matching the SOAP version', () => {
    const parsed = parseWsdl(CALCULATOR_WSDL);
    const [req]  = buildRequestsFromWsdl(parsed);
    const ct     = req.headers.find(h => h.key.toLowerCase() === 'content-type');
    expect(ct?.value).toBe(SOAP_11_CONTENT_TYPE);
  });
});

describe('buildMockFromWsdl', () => {
  it('builds one route per endpoint path with externalized envelope metadata', () => {
    const parsed = parseWsdl(CALCULATOR_WSDL);
    const mock   = buildMockFromWsdl('Calculator (mock)', parsed);
    expect(mock.routes).toHaveLength(1);
    const route = mock.routes[0];
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/calculator.asmx');
    // Envelopes live on metadata, not baked into the script body
    expect(route.metadata?.soapEnvelopes).toBeDefined();
    const envs = route.metadata!.soapEnvelopes as Record<string, string>;
    expect(Object.keys(envs)).toContain('Add');
    expect(envs.Add).toContain('<tns:AddResponse>');
    // The dispatch script reads envelopes by name from metadata, not as literals
    expect(route.script).toContain('metadata.soapEnvelopes');
    expect(route.script).not.toContain('<tns:AddResponse>'); // not embedded in script body
  });

  it('picks a free port avoiding collisions', () => {
    const parsed = parseWsdl(CALCULATOR_WSDL);
    const mock   = buildMockFromWsdl('m', parsed, [3900, 3901]);
    expect(mock.port).toBe(3902);
  });
});

describe('importWsdl', () => {
  it('wraps everything together and derives a service name from the endpoint host', () => {
    const result = importWsdl(CALCULATOR_WSDL);
    expect(result.collection.name).toMatch(/dneonline/);
    expect(result.collection.requests).toBeDefined();
    expect(Object.values(result.collection.requests)).toHaveLength(1);
    expect(result.mock.routes).toHaveLength(1);
  });

  it('respects an explicit name override', () => {
    const result = importWsdl(CALCULATOR_WSDL, { name: 'Calc' });
    expect(result.collection.name).toBe('Calc');
    expect(result.mock.name).toBe('Calc (mock)');
  });
});

describe('SOAP 1.2 content-type wiring', () => {
  it('attaches application/soap+xml when binding is soap12', () => {
    const wsdl = CALCULATOR_WSDL
      .replace('xmlns:soap=', 'xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:soap=')
      .replace('<soap:binding', '<soap12:binding')
      .replace('<soap:operation', '<soap12:operation');
    const parsed = parseWsdl(wsdl);
    const [req]  = buildRequestsFromWsdl(parsed);
    const ct     = req.headers.find(h => h.key.toLowerCase() === 'content-type');
    expect(ct?.value).toBe(SOAP_12_CONTENT_TYPE);
  });
});
