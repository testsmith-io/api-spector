import { type IpcMain } from 'electron';
import type { safeStorage as SafeStorageType } from 'electron';
import { pbkdf2Sync, createDecipheriv } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const MASTER_KEY_ENV = 'API_SPECTOR_MASTER_KEY';

// ─── OS-encrypted secret store (safeStorage) ─────────────────────────────────
//
// Secrets are encrypted with Electron's safeStorage (OS keychain on macOS/Win,
// libsecret on Linux) and persisted to <userData>/secrets.json.
// The CLI cannot access this store — it falls back to process.env only.

let secretStore: Record<string, string> = {};
let secretStorePath: string | null = null;

/**
 * Load the safeStorage-backed secret store from disk.
 * Must be called after app.whenReady() in the main process, before IPC handlers fire.
 */
export async function initSecretStore(userDataPath: string): Promise<void> {
  secretStorePath = join(userDataPath, 'secrets.json');
  try {
    const raw = await readFile(secretStorePath, 'utf8');
    secretStore = JSON.parse(raw);
  } catch {
    secretStore = {};
  }
}

async function persistSecretStore(): Promise<void> {
  if (!secretStorePath) return;
  await writeFile(secretStorePath, JSON.stringify(secretStore, null, 2), 'utf8');
}

/**
 * Lazily access Electron's safeStorage. Returns null in CLI (non-Electron) context
 * where require('electron') resolves to the binary path string, not the API.
 */
function getSafeStorage(): typeof SafeStorageType | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeStorage } = require('electron');
    if (typeof safeStorage?.isEncryptionAvailable === 'function') return safeStorage;
    return null;
  } catch {
    return null;
  }
}

// ─── Master key IPC ───────────────────────────────────────────────────────────

export function registerSecretHandlers(ipc: IpcMain): void {
  /** Returns whether the master password env var is currently set in this process. */
  ipc.handle('secret:checkMasterKey', () => {
    return { set: Boolean(process.env[MASTER_KEY_ENV]) };
  });

  /**
   * Sets the master password in the current process environment.
   * This lasts for the lifetime of the Electron process. Users should also
   * export API_SPECTOR_MASTER_KEY in their shell profile for persistence.
   */
  ipc.handle('secret:setMasterKey', (_e, value: string) => {
    process.env[MASTER_KEY_ENV] = value;
  });

  /**
   * Save a named secret to the OS-encrypted store.
   * The renderer calls this when the user clicks "Save" on a token/credential field.
   */
  ipc.handle('secret:set', async (_e, ref: string, value: string) => {
    const ss = getSafeStorage();
    if (!ss || !ss.isEncryptionAvailable()) {
      throw new Error('OS encryption is not available — set the secret via environment variable instead');
    }
    secretStore[ref] = ss.encryptString(value).toString('base64');
    await persistSecretStore();
  });
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
  const saltBuf = Buffer.from(salt, 'base64');
  const ivBuf   = Buffer.from(iv,   'base64');
  const encBuf  = Buffer.from(encrypted, 'base64');

  const key      = pbkdf2Sync(password, saltBuf, 100_000, 32, 'sha256');
  const authTag  = encBuf.subarray(encBuf.length - 16);
  const ciphertext = encBuf.subarray(0, encBuf.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, ivBuf);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Look up a secret by ref name.
 * Priority: safeStorage store → process.env fallback.
 * The CLI only ever reaches the process.env fallback since the store is never initialised.
 */
export async function getSecret(ref: string): Promise<string | null> {
  const stored = secretStore[ref];
  if (stored) {
    const ss = getSafeStorage();
    if (ss && ss.isEncryptionAvailable()) {
      try {
        return ss.decryptString(Buffer.from(stored, 'base64'));
      } catch {
        // corrupted entry — fall through to env
      }
    }
  }
  return process.env[ref] ?? null;
}
