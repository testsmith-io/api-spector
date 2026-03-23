import { describe, it, expect } from 'vitest'
import { validateConsumerResponse } from '../main/contract/consumer-verifier'
import type { ContractExpectation } from '../../shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noViolations(
  contract: ContractExpectation,
  status: number,
  headers: Record<string, string>,
  body: string,
) {
  const v = validateConsumerResponse(contract, status, headers, body)
  expect(v, `expected no violations but got: ${JSON.stringify(v)}`).toHaveLength(0)
}

function firstViolation(
  contract: ContractExpectation,
  status: number,
  headers: Record<string, string>,
  body: string,
) {
  const v = validateConsumerResponse(contract, status, headers, body)
  expect(v.length).toBeGreaterThan(0)
  return v[0]
}

// ─── Status code ──────────────────────────────────────────────────────────────

describe('validateConsumerResponse — status code', () => {
  it('passes when status matches expectation', () => {
    noViolations({ statusCode: 200 }, 200, {}, '{}')
  })

  it('passes when no statusCode expectation is set', () => {
    noViolations({}, 500, {}, '')
  })

  it('fails when status does not match', () => {
    const v = firstViolation({ statusCode: 200 }, 404, {}, '{}')
    expect(v.type).toBe('status_mismatch')
    expect(v.expected).toBe('200')
    expect(v.actual).toBe('404')
    expect(v.message).toContain('404')
  })

  it('includes both expected and actual in violation', () => {
    const [v] = validateConsumerResponse({ statusCode: 201 }, 400, {}, '')
    expect(v.expected).toBe('201')
    expect(v.actual).toBe('400')
  })
})

// ─── Required headers ─────────────────────────────────────────────────────────

describe('validateConsumerResponse — required headers', () => {
  it('passes when required header is present', () => {
    noViolations(
      { headers: [{ key: 'content-type', value: '', required: true }] },
      200,
      { 'content-type': 'application/json' },
      '',
    )
  })

  it('passes when optional header is absent', () => {
    noViolations(
      { headers: [{ key: 'x-optional', value: '', required: false }] },
      200,
      {},
      '',
    )
  })

  it('fails when required header is missing', () => {
    const v = firstViolation(
      { headers: [{ key: 'x-request-id', value: '', required: true }] },
      200,
      {},
      '',
    )
    expect(v.type).toBe('missing_header')
    expect(v.message).toContain('x-request-id')
    expect(v.actual).toBe('(absent)')
  })

  it('fails when required header has wrong value', () => {
    const v = firstViolation(
      { headers: [{ key: 'content-type', value: 'application/json', required: true }] },
      200,
      { 'content-type': 'text/html' },
      '',
    )
    expect(v.type).toBe('missing_header')
    expect(v.expected).toBe('application/json')
    expect(v.actual).toBe('text/html')
  })

  it('is case-insensitive for header name lookup', () => {
    noViolations(
      { headers: [{ key: 'Content-Type', value: '', required: true }] },
      200,
      { 'content-type': 'application/json' },  // lowercased key
      '',
    )
  })

  it('is case-insensitive for header value comparison', () => {
    noViolations(
      { headers: [{ key: 'content-type', value: 'Application/JSON', required: true }] },
      200,
      { 'content-type': 'application/json' },
      '',
    )
  })

  it('ignores content-type params when comparing values', () => {
    noViolations(
      { headers: [{ key: 'content-type', value: 'application/json', required: true }] },
      200,
      { 'content-type': 'application/json;charset=UTF-8' },
      '',
    )
  })

  it('ignores params on both sides', () => {
    noViolations(
      { headers: [{ key: 'content-type', value: 'application/json;charset=UTF-8', required: true }] },
      200,
      { 'content-type': 'application/json' },
      '',
    )
  })
})

// ─── Body schema ──────────────────────────────────────────────────────────────

describe('validateConsumerResponse — body schema', () => {
  it('passes when body matches schema', () => {
    const schema = JSON.stringify({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] })
    noViolations({ bodySchema: schema }, 200, {}, '{"id": 42}')
  })

  it('passes when no bodySchema is set', () => {
    noViolations({}, 200, {}, 'not even json')
  })

  it('passes when bodySchema is empty string', () => {
    noViolations({ bodySchema: '  ' }, 200, {}, '{}')
  })

  it('fails when body does not match schema', () => {
    const schema = JSON.stringify({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] })
    const v = firstViolation({ bodySchema: schema }, 200, {}, '{"name": "Alice"}')
    expect(v.type).toBe('schema_violation')
  })

  it('fails when body schema is invalid JSON', () => {
    const v = firstViolation({ bodySchema: '{not json}' }, 200, {}, '{}')
    expect(v.type).toBe('schema_violation')
    expect(v.message).toContain('not valid JSON')
  })

  it('fails when response body is not valid JSON', () => {
    const schema = JSON.stringify({ type: 'object' })
    const v = firstViolation({ bodySchema: schema }, 200, {}, 'plain text response')
    expect(v.type).toBe('schema_violation')
    expect(v.message).toContain('not valid JSON')
  })

  it('validates an array schema', () => {
    const schema = JSON.stringify({ type: 'array', items: { type: 'object' } })
    noViolations({ bodySchema: schema }, 200, {}, '[{"id":1},{"id":2}]')
  })

  it('includes schema path in violation', () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { name: { type: 'integer' } },
      required: ['name'],
    })
    const [v] = validateConsumerResponse({ bodySchema: schema }, 200, {}, '{"name": "string-not-integer"}')
    expect(v.type).toBe('schema_violation')
    expect(v.path).toBeDefined()
  })
})

// ─── Combined violations ──────────────────────────────────────────────────────

describe('validateConsumerResponse — combined', () => {
  it('returns multiple violations from different checks', () => {
    const schema = JSON.stringify({ type: 'object', required: ['id'] })
    const violations = validateConsumerResponse(
      {
        statusCode: 200,
        headers: [{ key: 'x-trace', value: '', required: true }],
        bodySchema: schema,
      },
      404,
      {},
      '{}',
    )
    // status mismatch + missing header + schema violation (missing required id)
    expect(violations.length).toBeGreaterThanOrEqual(2)
    expect(violations.some(v => v.type === 'status_mismatch')).toBe(true)
    expect(violations.some(v => v.type === 'missing_header')).toBe(true)
  })

  it('returns empty array for fully compliant response', () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
    })
    const violations = validateConsumerResponse(
      {
        statusCode: 200,
        headers: [{ key: 'content-type', value: 'application/json', required: true }],
        bodySchema: schema,
      },
      200,
      { 'content-type': 'application/json' },
      '{"id": 1, "name": "Alice"}',
    )
    expect(violations).toHaveLength(0)
  })
})
