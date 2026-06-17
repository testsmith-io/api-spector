// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// NTLM (NTLMv2) message construction, per [MS-NLMP].
//
// We implement this ourselves rather than pull in a dependency because:
//   - the NT hash needs MD4, which OpenSSL 3 (Node's crypto) no longer exposes,
//     so we ship a small pure-JS MD4 below; and
//   - we only need NTLMv2, which is HMAC-MD5 based — no DES, no LM hash.
//
// The transport (3-message handshake over one keep-alive socket) lives in
// auth-builder.ts; this module is pure encoding and is unit-tested against the
// worked example in [MS-NLMP] §4.2.4.

import crypto from 'crypto';

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');

// NegotiateFlags bits we care about.
const F_UNICODE       = 0x00000001;
const F_OEM           = 0x00000002;
const F_REQUEST_TARGET = 0x00000004;
const F_NTLM          = 0x00000200;
const F_ALWAYS_SIGN   = 0x00008000;
const F_EXT_SESSION    = 0x00080000; // NTLMSSP_NEGOTIATE_EXTENDED_SESSIONSECURITY

const TYPE1_FLAGS = F_UNICODE | F_OEM | F_REQUEST_TARGET | F_NTLM | F_ALWAYS_SIGN | F_EXT_SESSION;
const TYPE3_FLAGS = F_UNICODE | F_NTLM | F_ALWAYS_SIGN | F_EXT_SESSION;

// ─── MD4 (pure JS — crypto can't provide it under OpenSSL 3) ───────────────────

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function md4(msg: Buffer): Buffer {
  const len = msg.length;
  const bitLen = len * 8;
  const padLen = (56 - ((len + 1) % 64) + 64) % 64;
  const total = len + 1 + padLen + 8;
  const buf = Buffer.alloc(total);
  msg.copy(buf, 0);
  buf[len] = 0x80;
  buf.writeUInt32LE(bitLen >>> 0, total - 8);
  buf.writeUInt32LE(Math.floor(bitLen / 0x100000000) >>> 0, total - 4);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const X = new Array<number>(16);

  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;
  const FF = (aa: number, bb: number, cc: number, dd: number, k: number, s: number) =>
    rotl((aa + F(bb, cc, dd) + X[k]) >>> 0, s);
  const GG = (aa: number, bb: number, cc: number, dd: number, k: number, s: number) =>
    rotl((aa + G(bb, cc, dd) + X[k] + 0x5a827999) >>> 0, s);
  const HH = (aa: number, bb: number, cc: number, dd: number, k: number, s: number) =>
    rotl((aa + H(bb, cc, dd) + X[k] + 0x6ed9eba1) >>> 0, s);

  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) X[j] = buf.readUInt32LE(i + j * 4);
    const aa = a, bb = b, cc = c, dd = d;

    // Round 1
    for (let k = 0; k < 16; k += 4) {
      a = FF(a, b, c, d, k,     3);
      d = FF(d, a, b, c, k + 1, 7);
      c = FF(c, d, a, b, k + 2, 11);
      b = FF(b, c, d, a, k + 3, 19);
    }
    // Round 2
    for (let k = 0; k < 4; k++) {
      a = GG(a, b, c, d, k,      3);
      d = GG(d, a, b, c, k + 4,  5);
      c = GG(c, d, a, b, k + 8,  9);
      b = GG(b, c, d, a, k + 12, 13);
    }
    // Round 3
    const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let k = 0; k < 16; k += 4) {
      a = HH(a, b, c, d, order[k],     3);
      d = HH(d, a, b, c, order[k + 1], 9);
      c = HH(c, d, a, b, order[k + 2], 11);
      b = HH(b, c, d, a, order[k + 3], 15);
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  const out = Buffer.alloc(16);
  out.writeUInt32LE(a, 0);
  out.writeUInt32LE(b, 4);
  out.writeUInt32LE(c, 8);
  out.writeUInt32LE(d, 12);
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const utf16le = (s: string) => Buffer.from(s, 'utf16le');
const hmacMd5 = (key: Buffer, data: Buffer) => crypto.createHmac('md5', key).update(data).digest();

/** NTOWFv2 = HMAC_MD5(MD4(UNICODE(password)), UNICODE(UPPER(user) + domain)). */
export function ntowfv2(user: string, domain: string, password: string): Buffer {
  const ntHash = md4(utf16le(password));
  return hmacMd5(ntHash, utf16le(user.toUpperCase() + domain));
}

/** FILETIME: 100-ns ticks since 1601-01-01, little-endian. */
function filetime(unixMs: number): Buffer {
  const ticks = (BigInt(unixMs) + 11644473600000n) * 10000n;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(ticks);
  return buf;
}

// ─── Type 1: NEGOTIATE ──────────────────────────────────────────────────────

/** Build the Type 1 (negotiate) token, base64-encoded (no "NTLM " prefix). */
export function createType1Message(): string {
  const msg = Buffer.alloc(32);
  SIGNATURE.copy(msg, 0);
  msg.writeUInt32LE(1, 8);            // MessageType
  msg.writeUInt32LE(TYPE1_FLAGS, 12); // NegotiateFlags
  // Domain (8) and Workstation (8) fields left zeroed; offset points past header.
  msg.writeUInt32LE(32, 16); // domain offset
  msg.writeUInt32LE(32, 24); // workstation offset
  return msg.toString('base64');
}

// ─── Type 2: CHALLENGE (parse) ──────────────────────────────────────────────

export interface Type2Challenge {
  serverChallenge: Buffer  // 8 bytes
  targetInfo: Buffer       // AV_PAIR block (may be empty)
  flags: number
}

/** Parse a Type 2 (challenge) token (base64 string or raw bytes). */
export function decodeType2Message(token: string | Buffer): Type2Challenge {
  const buf = Buffer.isBuffer(token) ? token : Buffer.from(token, 'base64');
  if (buf.length < 32 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Invalid NTLM Type 2 message');
  }
  const flags = buf.readUInt32LE(20);
  const serverChallenge = Buffer.from(buf.subarray(24, 32));

  let targetInfo = Buffer.alloc(0);
  if (buf.length >= 48) {
    const tiLen = buf.readUInt16LE(40);
    const tiOff = buf.readUInt32LE(44);
    if (tiLen > 0 && tiOff + tiLen <= buf.length) {
      targetInfo = Buffer.from(buf.subarray(tiOff, tiOff + tiLen));
    }
  }
  return { serverChallenge, targetInfo, flags };
}

// ─── NTLMv2 response computation ──────────────────────────────────────────────

export interface NtlmV2Response {
  ntResponse: Buffer  // NTProofStr (16) + blob
  lmResponse: Buffer  // 24 bytes
  ntProof: Buffer     // 16 bytes (exposed for testing)
}

export function computeNtlmV2Response(opts: {
  user: string
  domain: string
  password: string
  serverChallenge: Buffer
  targetInfo: Buffer
  clientChallenge: Buffer  // 8 bytes
  timestamp: Buffer        // 8-byte FILETIME
}): NtlmV2Response {
  const responseKey = ntowfv2(opts.user, opts.domain, opts.password);

  // "temp" blob, [MS-NLMP] §3.3.2 / §2.2.2.7
  const blob = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00]), // RespType + HiRespType + reserved
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    opts.timestamp,
    opts.clientChallenge,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    opts.targetInfo,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);

  const ntProof = hmacMd5(responseKey, Buffer.concat([opts.serverChallenge, blob]));
  const ntResponse = Buffer.concat([ntProof, blob]);

  const lmProof = hmacMd5(responseKey, Buffer.concat([opts.serverChallenge, opts.clientChallenge]));
  const lmResponse = Buffer.concat([lmProof, opts.clientChallenge]);

  return { ntResponse, lmResponse, ntProof };
}

// ─── Type 3: AUTHENTICATE ──────────────────────────────────────────────────

export interface Type3Options {
  user: string
  password: string
  domain?: string
  workstation?: string
  challenge: Type2Challenge
  /** Test seams — supplied randomly/by clock in production. */
  clientChallenge?: Buffer
  timestamp?: number  // unix ms
}

/** Build the Type 3 (authenticate) token, base64-encoded (no "NTLM " prefix). */
export function createType3Message(opts: Type3Options): string {
  const domain = opts.domain ?? '';
  const workstation = opts.workstation ?? '';
  const clientChallenge = opts.clientChallenge ?? crypto.randomBytes(8);
  const timestamp = filetime(opts.timestamp ?? Date.now());

  const { ntResponse, lmResponse } = computeNtlmV2Response({
    user: opts.user,
    domain,
    password: opts.password,
    serverChallenge: opts.challenge.serverChallenge,
    targetInfo: opts.challenge.targetInfo,
    clientChallenge,
    timestamp,
  });

  const domainBuf = utf16le(domain);
  const userBuf   = utf16le(opts.user);
  const wsBuf     = utf16le(workstation);

  // Header: signature(8) + type(4) + 6×field(8) + flags(4) = 64 bytes.
  const HEADER = 64;
  const payload = Buffer.concat([lmResponse, ntResponse, domainBuf, userBuf, wsBuf]);
  const msg = Buffer.alloc(HEADER + payload.length);

  SIGNATURE.copy(msg, 0);
  msg.writeUInt32LE(3, 8); // MessageType

  let off = HEADER;
  const writeField = (pos: number, buf: Buffer) => {
    msg.writeUInt16LE(buf.length, pos);     // Len
    msg.writeUInt16LE(buf.length, pos + 2); // MaxLen
    msg.writeUInt32LE(buf.length ? off : HEADER, pos + 4); // BufferOffset
    buf.copy(msg, off);
    off += buf.length;
  };

  writeField(12, lmResponse);   // LmChallengeResponse
  writeField(20, ntResponse);   // NtChallengeResponse
  writeField(28, domainBuf);    // DomainName
  writeField(36, userBuf);      // UserName
  writeField(44, wsBuf);        // Workstation
  // EncryptedRandomSessionKey (52): empty
  msg.writeUInt16LE(0, 52);
  msg.writeUInt16LE(0, 54);
  msg.writeUInt32LE(HEADER, 56);

  msg.writeUInt32LE(TYPE3_FLAGS, 60); // NegotiateFlags

  return msg.toString('base64');
}
