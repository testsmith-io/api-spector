import { describe, it, expect } from 'vitest'
import { parseWsdl, buildEnvelopeTemplate } from '../main/ipc/soap-handler'

// ─── Minimal WSDL fixtures ────────────────────────────────────────────────────

const SIMPLE_WSDL = `
<definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
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
</definitions>`

const NO_NAMESPACE_WSDL = `
<definitions>
  <operation name="Ping">
    <soap:operation soapAction="urn:Ping"/>
  </operation>
</definitions>`

const EMPTY_WSDL = `<definitions targetNamespace="http://empty.example.com"></definitions>`

// ─── parseWsdl ────────────────────────────────────────────────────────────────

describe('parseWsdl', () => {
  it('extracts targetNamespace', () => {
    const result = parseWsdl(SIMPLE_WSDL)
    expect(result.targetNamespace).toBe('http://example.com/calculator')
  })

  it('extracts all operation names', () => {
    const result = parseWsdl(SIMPLE_WSDL)
    const names = result.operations.map(o => o.name)
    expect(names).toContain('Add')
    expect(names).toContain('Subtract')
  })

  it('extracts SOAPAction for each operation', () => {
    const result = parseWsdl(SIMPLE_WSDL)
    const add = result.operations.find(o => o.name === 'Add')
    expect(add?.soapAction).toBe('http://example.com/Add')
  })

  it('operation with no SOAPAction has undefined soapAction', () => {
    const wsdl = `
<definitions targetNamespace="http://ns">
  <operation name="NoAction"/>
</definitions>`
    const result = parseWsdl(wsdl)
    const op = result.operations.find(o => o.name === 'NoAction')
    expect(op?.soapAction).toBeUndefined()
  })

  it('builds an envelope template for each operation', () => {
    const result = parseWsdl(SIMPLE_WSDL)
    for (const op of result.operations) {
      expect(op.inputTemplate).toContain('<soap:Envelope')
      expect(op.inputTemplate).toContain(op.name)
    }
  })

  it('returns empty operations array for WSDL with no operations', () => {
    const result = parseWsdl(EMPTY_WSDL)
    expect(result.operations).toHaveLength(0)
  })

  it('falls back to empty string when targetNamespace is absent', () => {
    const result = parseWsdl(NO_NAMESPACE_WSDL)
    expect(result.targetNamespace).toBe('')
  })

  it('handles non-prefixed operation tags', () => {
    const result = parseWsdl(NO_NAMESPACE_WSDL)
    const names = result.operations.map(o => o.name)
    expect(names).toContain('Ping')
  })
})

// ─── buildEnvelopeTemplate ────────────────────────────────────────────────────

describe('buildEnvelopeTemplate', () => {
  it('wraps the operation name in tns namespace', () => {
    const xml = buildEnvelopeTemplate('GetUser', 'http://example.com')
    expect(xml).toContain('<tns:GetUser>')
    expect(xml).toContain('</tns:GetUser>')
  })

  it('includes the provided namespace in xmlns:tns', () => {
    const xml = buildEnvelopeTemplate('Op', 'urn:my-ns')
    expect(xml).toContain('xmlns:tns="urn:my-ns"')
  })

  it('always contains a soap:Body element', () => {
    const xml = buildEnvelopeTemplate('Anything', 'urn:ns')
    expect(xml).toContain('<soap:Body>')
    expect(xml).toContain('</soap:Body>')
  })

  it('starts with an XML declaration', () => {
    const xml = buildEnvelopeTemplate('Op', 'urn:ns')
    expect(xml.trimStart()).toMatch(/^<\?xml/)
  })

  it('works with empty namespace', () => {
    const xml = buildEnvelopeTemplate('Op', '')
    expect(xml).toContain('xmlns:tns=""')
  })
})
