// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { createHash, createHmac } from 'node:crypto';

// Minimal AWS Signature Version 4 signer — enough to call a single JSON API
// (e.g. Secrets Manager GetSecretValue) without pulling in the AWS SDK. The
// clock is injected so it is deterministic and testable against AWS's published
// signing vectors.

export interface SigV4Input {
  method: string;
  host: string;
  path: string;
  query?: string;
  headers: Record<string, string>;
  body: string;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now: Date;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// Returns the full header set (including Authorization + x-amz-date) to send.
export function signSigV4(input: SigV4Input): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...input.headers, host: input.host, 'x-amz-date': amzDate };
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;

  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k].trim().replace(/\s+/g, ' ');
  const sortedKeys = Object.keys(lower).sort();

  const canonicalHeaders = sortedKeys.map((k) => `${k}:${lower[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const payloadHash = sha256hex(input.body);

  const canonicalRequest = [input.method, input.path, input.query ?? '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
