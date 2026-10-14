// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../main/ipc/secret-handler';

describe('encryptSecret / decryptSecret (main, master-key path)', () => {
  it('round-trips a value with the same password', () => {
    const f = encryptSecret('s3cr3t-token', 'master-pw');
    const back = decryptSecret(f.secretEncrypted, f.secretSalt, f.secretIv, 'master-pw');
    expect(back).toBe('s3cr3t-token');
  });

  it('produces the field shape the env file / renderer expect', () => {
    const f = encryptSecret('v', 'pw');
    expect(Object.keys(f).sort()).toEqual(['secretEncrypted', 'secretHash', 'secretIv', 'secretSalt']);
    // salt 16 bytes, iv 12 bytes (base64 lengths), hash = first 8 hex of SHA-256.
    expect(Buffer.from(f.secretSalt, 'base64')).toHaveLength(16);
    expect(Buffer.from(f.secretIv, 'base64')).toHaveLength(12);
    expect(f.secretHash).toBe(createHash('sha256').update('v').digest('hex').slice(0, 8));
  });

  it('uses a random salt + iv each call (ciphertext differs)', () => {
    const a = encryptSecret('same', 'pw');
    const b = encryptSecret('same', 'pw');
    expect(a.secretEncrypted).not.toBe(b.secretEncrypted);
    expect(a.secretSalt).not.toBe(b.secretSalt);
  });

  it('fails to decrypt with the wrong password (GCM auth tag)', () => {
    const f = encryptSecret('x', 'right');
    expect(() => decryptSecret(f.secretEncrypted, f.secretSalt, f.secretIv, 'wrong')).toThrow();
  });
});
