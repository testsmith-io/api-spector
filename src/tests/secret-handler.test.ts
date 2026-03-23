import { describe, it, expect, afterEach } from 'vitest'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'crypto'
import { decryptSecret, getSecret } from '../main/ipc/secret-handler'

// ─── Helper: encrypt with the same algorithm used by the renderer ─────────────

function encryptForTest(plaintext: string, password: string): {
  secretEncrypted: string
  secretSalt: string
  secretIv: string
} {
  const salt = randomBytes(16)
  const iv   = randomBytes(12)
  const key  = pbkdf2Sync(password, salt, 100_000, 32, 'sha256')

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag   = cipher.getAuthTag()

  return {
    secretEncrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
    secretSalt:      salt.toString('base64'),
    secretIv:        iv.toString('base64'),
  }
}

// ─── decryptSecret ────────────────────────────────────────────────────────────

describe('decryptSecret', () => {
  it('decrypts a value encrypted with the correct password', () => {
    const password = 'my-master-password'
    const { secretEncrypted, secretSalt, secretIv } = encryptForTest('super-secret-value', password)
    const result = decryptSecret(secretEncrypted, secretSalt, secretIv, password)
    expect(result).toBe('super-secret-value')
  })

  it('decrypts an empty string', () => {
    const password = 'pass'
    const { secretEncrypted, secretSalt, secretIv } = encryptForTest('', password)
    expect(decryptSecret(secretEncrypted, secretSalt, secretIv, password)).toBe('')
  })

  it('decrypts a value containing special characters', () => {
    const password = 'pass'
    const value = 'p@$$w0rd!#&*()=+[]{}|'
    const { secretEncrypted, secretSalt, secretIv } = encryptForTest(value, password)
    expect(decryptSecret(secretEncrypted, secretSalt, secretIv, password)).toBe(value)
  })

  it('decrypts a long value', () => {
    const password = 'pass'
    const value = 'a'.repeat(1000)
    const { secretEncrypted, secretSalt, secretIv } = encryptForTest(value, password)
    expect(decryptSecret(secretEncrypted, secretSalt, secretIv, password)).toBe(value)
  })

  it('throws when the password is wrong', () => {
    const { secretEncrypted, secretSalt, secretIv } = encryptForTest('secret', 'correct-password')
    expect(() => decryptSecret(secretEncrypted, secretSalt, secretIv, 'wrong-password')).toThrow()
  })

  it('throws when the ciphertext is corrupted', () => {
    const password = 'pass'
    const { secretSalt, secretIv } = encryptForTest('secret', password)
    expect(() => decryptSecret('bm90dmFsaWRiYXNlNjQ=', secretSalt, secretIv, password)).toThrow()
  })

  it('produces different ciphertexts for the same value (random salt/iv)', () => {
    const password = 'pass'
    const a = encryptForTest('same-value', password)
    const b = encryptForTest('same-value', password)
    expect(a.secretEncrypted).not.toBe(b.secretEncrypted)
  })
})

// ─── getSecret ────────────────────────────────────────────────────────────────

describe('getSecret', () => {
  const TEST_KEY = '__SPECTOR_TEST_SECRET__'

  afterEach(() => {
    delete process.env[TEST_KEY]
  })

  it('returns the env var value when set', async () => {
    process.env[TEST_KEY] = 'my-secret-value'
    await expect(getSecret(TEST_KEY)).resolves.toBe('my-secret-value')
  })

  it('returns null when the env var is not set', async () => {
    await expect(getSecret(TEST_KEY)).resolves.toBeNull()
  })

  it('returns an empty string when the env var is set to empty', async () => {
    process.env[TEST_KEY] = ''
    await expect(getSecret(TEST_KEY)).resolves.toBe('')
  })
})
