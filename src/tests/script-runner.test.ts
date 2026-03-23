import { describe, it, expect } from 'vitest'
import { runScript } from '../main/script-runner'

const baseCtx = {
  envVars: {},
  collectionVars: {},
  globals: {},
  localVars: {},
}

// ─── Basic execution ──────────────────────────────────────────────────────────

describe('runScript — basic', () => {
  it('runs without error on an empty script', async () => {
    const result = await runScript('', baseCtx)
    expect(result.error).toBeUndefined()
  })

  it('captures console.log output', async () => {
    const result = await runScript('console.log("hello")', baseCtx)
    expect(result.consoleOutput).toContain('hello')
  })

  it('captures console.warn with prefix', async () => {
    const result = await runScript('console.warn("careful")', baseCtx)
    expect(result.consoleOutput[0]).toBe('[warn] careful')
  })

  it('captures console.error with prefix', async () => {
    const result = await runScript('console.error("oops")', baseCtx)
    expect(result.consoleOutput[0]).toBe('[error] oops')
  })

  it('returns an error message for syntax errors', async () => {
    const result = await runScript('this is not valid js !!##', baseCtx)
    expect(result.error).toBeDefined()
  })

  it('returns an error message when script throws', async () => {
    const result = await runScript('throw new Error("boom")', baseCtx)
    expect(result.error).toContain('boom')
  })
})

// ─── sp.test ─────────────────────────────────────────────────────────────────

describe('runScript — sp.test', () => {
  it('records a passing test', async () => {
    const result = await runScript(`sp.test('it passes', () => {})`, baseCtx)
    expect(result.testResults).toHaveLength(1)
    expect(result.testResults[0].passed).toBe(true)
    expect(result.testResults[0].name).toBe('it passes')
  })

  it('records a failing test with error message', async () => {
    const result = await runScript(
      `sp.test('it fails', () => { sp.expect(1).to.equal(2) })`,
      baseCtx,
    )
    expect(result.testResults[0].passed).toBe(false)
    expect(result.testResults[0].error).toMatch(/equal/)
  })

  it('continues running after a failed test', async () => {
    const script = `
      sp.test('fail', () => { sp.expect(1).to.equal(2) })
      sp.test('pass', () => {})
    `
    const result = await runScript(script, baseCtx)
    expect(result.testResults).toHaveLength(2)
    expect(result.testResults[1].passed).toBe(true)
  })
})

// ─── sp.expect assertions ─────────────────────────────────────────────────────

describe('runScript — sp.expect', () => {
  async function passes(assertion: string) {
    const result = await runScript(
      `sp.test('t', () => { ${assertion} })`,
      baseCtx,
    )
    return result.testResults[0].passed
  }

  it('equal — passes on matching values', async () => expect(await passes(`sp.expect(1).to.equal(1)`)).toBe(true))
  it('equal — fails on mismatched values', async () => expect(await passes(`sp.expect(1).to.equal(2)`)).toBe(false))
  it('not.equal — passes when values differ', async () => expect(await passes(`sp.expect(1).to.not.equal(2)`)).toBe(true))
  it('include — passes when string contains substring', async () => expect(await passes(`sp.expect('hello world').to.include('world')`)).toBe(true))
  it('property — passes when object has the property', async () => expect(await passes(`sp.expect({a:1}).to.have.property('a')`)).toBe(true))
  it('a — passes for correct type', async () => expect(await passes(`sp.expect('hi').to.be.a('string')`)).toBe(true))
  it('above — passes when value is greater', async () => expect(await passes(`sp.expect(5).to.be.above(4)`)).toBe(true))
  it('below — passes when value is less', async () => expect(await passes(`sp.expect(3).to.be.below(4)`)).toBe(true))
  it('ok — passes for truthy value', async () => expect(await passes(`sp.expect(1).to.be.ok`)).toBe(true))
  it('true — passes for boolean true', async () => expect(await passes(`sp.expect(true).to.be.true`)).toBe(true))
  it('null — passes for null', async () => expect(await passes(`sp.expect(null).to.be.null`)).toBe(true))
})

// ─── Variable scopes ─────────────────────────────────────────────────────────

describe('runScript — variable scopes', () => {
  it('can read env vars', async () => {
    const result = await runScript(
      `console.log(sp.environment.get('HOST'))`,
      { ...baseCtx, envVars: { HOST: 'example.com' } },
    )
    expect(result.consoleOutput[0]).toBe('example.com')
  })

  it('can write env vars and they are returned', async () => {
    const result = await runScript(
      `sp.environment.set('token', 'abc123')`,
      baseCtx,
    )
    expect(result.updatedEnvVars.token).toBe('abc123')
  })

  it('can write collection vars and they are returned', async () => {
    const result = await runScript(
      `sp.collectionVariables.set('userId', '42')`,
      baseCtx,
    )
    expect(result.updatedCollectionVars.userId).toBe('42')
  })

  it('can write globals and they are returned', async () => {
    const result = await runScript(
      `sp.globals.set('session', 'xyz')`,
      baseCtx,
    )
    expect(result.updatedGlobals.session).toBe('xyz')
  })

  it('sp.variables_get reads across scopes, local wins', async () => {
    const result = await runScript(
      `console.log(sp.variables_get('key'))`,
      { ...baseCtx, envVars: { key: 'env' }, localVars: { key: 'local' } },
    )
    expect(result.consoleOutput[0]).toBe('local')
  })
})

// ─── Response access ─────────────────────────────────────────────────────────

describe('runScript — sp.response', () => {
  const ctx = {
    ...baseCtx,
    response: {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, name: 'Jane' }),
      bodySize: 24,
      durationMs: 42,
    },
  }

  it('exposes response status code', async () => {
    const result = await runScript(`console.log(sp.response.code)`, ctx)
    expect(result.consoleOutput[0]).toBe('200')
  })

  it('exposes response time', async () => {
    const result = await runScript(`console.log(sp.response.responseTime)`, ctx)
    expect(result.consoleOutput[0]).toBe('42')
  })

  it('parses JSON body via sp.response.json()', async () => {
    const result = await runScript(
      `var b = sp.response.json(); console.log(b.name)`,
      ctx,
    )
    expect(result.consoleOutput[0]).toBe('Jane')
  })

  it('reads response headers', async () => {
    const result = await runScript(
      `console.log(sp.response.headers.get('content-type'))`,
      ctx,
    )
    expect(result.consoleOutput[0]).toBe('application/json')
  })

  it('response.to.have.status passes on correct code', async () => {
    const result = await runScript(
      `sp.test('ok', () => { sp.response.to.have.status(200) })`,
      ctx,
    )
    expect(result.testResults[0].passed).toBe(true)
  })

  it('response.to.have.status fails on wrong code', async () => {
    const result = await runScript(
      `sp.test('ok', () => { sp.response.to.have.status(404) })`,
      ctx,
    )
    expect(result.testResults[0].passed).toBe(false)
  })
})
