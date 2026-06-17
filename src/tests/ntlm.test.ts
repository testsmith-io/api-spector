// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import {
  md4,
  ntowfv2,
  computeNtlmV2Response,
  createType1Message,
  decodeType2Message,
  createType3Message,
} from '../main/ntlm';

const hex = (b: Buffer) => b.toString('hex');

describe('md4', () => {
  // RFC 1320 test vectors
  it('hashes the empty string', () => {
    expect(hex(md4(Buffer.from('')))).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
  });
  it('hashes "abc"', () => {
    expect(hex(md4(Buffer.from('abc')))).toBe('a448017aaf21d8525fc10ae87aa6729d');
  });
  it('hashes the long alphanumeric vector', () => {
    const msg = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    expect(hex(md4(Buffer.from(msg)))).toBe('043f8582f241db351ce627e153e7f0e4');
  });
});

// [MS-NLMP] §4.2.4 — the canonical NTLMv2 worked example.
describe('NTLMv2 — [MS-NLMP] §4.2.4 reference vectors', () => {
  const user = 'User';
  const domain = 'Domain';
  const password = 'Password';
  const serverChallenge = Buffer.from('0123456789abcdef', 'hex');
  const clientChallenge = Buffer.from('aaaaaaaaaaaaaaaa', 'hex');
  const timestamp = Buffer.alloc(8); // all zeros, per the example
  // §4.2.4.1.3 target info (AV_PAIRs: NetBIOS domain "Domain", server "Server")
  const targetInfo = Buffer.from(
    '02000c0044006f006d00610069006e000100' +
    '0c0053006500720076006500720000000000',
    'hex',
  );

  it('NTOWFv2 matches the spec', () => {
    expect(hex(ntowfv2(user, domain, password))).toBe('0c868a403bfd7a93a3001ef22ef02e3f');
  });

  it('NTProofStr matches the spec', () => {
    const { ntProof } = computeNtlmV2Response({
      user, domain, password, serverChallenge, targetInfo, clientChallenge, timestamp,
    });
    expect(hex(ntProof)).toBe('68cd0ab851e51c96aabc927bebef6a1c');
  });

  it('NtChallengeResponse = NTProofStr followed by the blob', () => {
    const { ntResponse, ntProof } = computeNtlmV2Response({
      user, domain, password, serverChallenge, targetInfo, clientChallenge, timestamp,
    });
    expect(ntResponse.subarray(0, 16)).toEqual(ntProof);
    // blob begins with 0x01010000 + 4 reserved zero bytes
    expect(hex(ntResponse.subarray(16, 24))).toBe('0101000000000000');
  });
});

describe('NTLM message framing', () => {
  it('Type 1 is a well-formed NTLMSSP negotiate message', () => {
    const buf = Buffer.from(createType1Message(), 'base64');
    expect(buf.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
    expect(buf.readUInt32LE(8)).toBe(1);
  });

  it('round-trips a Type 2 challenge into a parseable Type 3', () => {
    // Hand-build a minimal Type 2 challenge with a server challenge + target info.
    const targetInfo = Buffer.from('02000c0044006f006d00610069006e000000', 'hex');
    const t2 = Buffer.alloc(48 + targetInfo.length);
    Buffer.from('NTLMSSP\0', 'latin1').copy(t2, 0);
    t2.writeUInt32LE(2, 8);
    Buffer.from('1122334455667788', 'hex').copy(t2, 24); // server challenge
    t2.writeUInt16LE(targetInfo.length, 40);
    t2.writeUInt16LE(targetInfo.length, 42);
    t2.writeUInt32LE(48, 44);
    targetInfo.copy(t2, 48);

    const challenge = decodeType2Message(t2.toString('base64'));
    expect(hex(challenge.serverChallenge)).toBe('1122334455667788');
    expect(challenge.targetInfo.equals(targetInfo)).toBe(true);

    const t3 = Buffer.from(createType3Message({
      user: 'alice', password: 'secret', domain: 'CORP', workstation: 'PC1',
      challenge,
      clientChallenge: Buffer.from('aaaaaaaaaaaaaaaa', 'hex'),
      timestamp: 0,
    }), 'base64');

    expect(t3.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
    expect(t3.readUInt32LE(8)).toBe(3);
    // NtChallengeResponse field present and pointing inside the message
    const ntLen = t3.readUInt16LE(20);
    const ntOff = t3.readUInt32LE(24);
    expect(ntLen).toBeGreaterThan(16);
    expect(ntOff + ntLen).toBeLessThanOrEqual(t3.length);
    // UserName decodes back as UTF-16LE
    const userLen = t3.readUInt16LE(36);
    const userOff = t3.readUInt32LE(40);
    expect(t3.subarray(userOff, userOff + userLen).toString('utf16le')).toBe('alice');
  });
});
