// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { KeyValuePair } from './types';

// ─── Shared SOAP constants & helpers ─────────────────────────────────────────
//
// Lives in `shared/` so renderer (SoapEditor), main process (wsdl-import,
// soap-handler), and the CLI all reference the same source of truth.

export const SOAP_11_CONTENT_TYPE = 'text/xml; charset=utf-8';
export const SOAP_12_CONTENT_TYPE = 'application/soap+xml; charset=utf-8';

export function contentTypeForSoap(version: '1.1' | '1.2'): string {
  return version === '1.2' ? SOAP_12_CONTENT_TYPE : SOAP_11_CONTENT_TYPE;
}

/** Replace (or append) the Content-Type header on a request, preserving the
 *  user's other headers. SOAP 1.1 wants `text/xml`, 1.2 wants
 *  `application/soap+xml`. */
export function withContentType(headers: KeyValuePair[], value: string): KeyValuePair[] {
  const idx = headers.findIndex(h => h.key.toLowerCase() === 'content-type');
  const next: KeyValuePair = { key: 'Content-Type', value, enabled: true };
  if (idx === -1) return [...headers, next];
  return headers.map((h, i) => (i === idx ? { ...h, value, enabled: true } : h));
}
