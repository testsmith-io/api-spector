import { type IpcMain } from 'electron'
import { pbkdf2Sync, createDecipheriv } from 'crypto'

const MASTER_KEY_ENV = 'API_SPECTOR_MASTER_KEY'

// ─── Master key IPC ───────────────────────────────────────────────────────────

export function registerSecretHandlers(ipc: IpcMain): void {
  /** Returns whether the master password env var is currently set in this process. */
  ipc.handle('secret:checkMasterKey', () => {
    return { set: Boolean(process.env[MASTER_KEY_ENV]) }
  })

  /**
   * Sets the master password in the current process environment.
   * This lasts for the lifetime of the Electron process. Users should also
   * export API_SPECTOR_MASTER_KEY in their shell profile for persistence.
   */
  ipc.handle('secret:setMasterKey', (_e, value: string) => {
    process.env[MASTER_KEY_ENV] = value
  })
}

// ─── Decrypt utility (used internally by interpolation.ts) ───────────────────

/**
 * Decrypt an AES-256-GCM secret.
 * @param encrypted  base64(ciphertext + 16-byte auth-tag)
 * @param salt       base64(16-byte PBKDF2 salt)
 * @param iv         base64(12-byte GCM IV)
 * @param password   master password (from API_SPECTOR_MASTER_KEY)
 */
export function decryptSecret(
  encrypted: string,
  salt: string,
  iv: string,
  password: string,
): string {
  const saltBuf = Buffer.from(salt, 'base64')
  const ivBuf   = Buffer.from(iv,   'base64')
  const encBuf  = Buffer.from(encrypted, 'base64')

  const key      = pbkdf2Sync(password, saltBuf, 100_000, 32, 'sha256')
  const authTag  = encBuf.subarray(encBuf.length - 16)
  const ciphertext = encBuf.subarray(0, encBuf.length - 16)

  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Fall-back for auth.tokenSecretRef / auth.apiKeySecretRef:
 * read the value directly from a process.env variable of that name.
 */
export async function getSecret(ref: string): Promise<string | null> {
  return process.env[ref] ?? null
}
