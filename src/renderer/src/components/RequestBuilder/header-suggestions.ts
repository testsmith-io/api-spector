// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/** Common HTTP request header names, ordered by frequency of use. */
export const HEADER_NAMES: string[] = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Cache-Control',
  'Accept-Language',
  'Accept-Encoding',
  'Connection',
  'Content-Encoding',
  'Content-Length',
  'Cookie',
  'Host',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Api-Key',
  'X-Auth-Token',
  'X-Correlation-ID',
  'X-Request-ID',
  'X-Forwarded-For',
  'X-Requested-With',
  'X-Tenant-ID',
  'If-Match',
  'If-None-Match',
  'If-Modified-Since',
  'If-Unmodified-Since',
  'If-Range',
  'Date',
  'Expect',
  'From',
  'Max-Forwards',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'TE',
  'Upgrade',
  'Via',
  'Warning',
]

/** Common values for headers that have well-known value sets. */
export const HEADER_VALUE_SUGGESTIONS: Record<string, string[]> = {
  'accept': [
    'application/json',
    'application/xml',
    'text/html',
    'text/plain',
    'application/ld+json',
    '*/*',
  ],
  'content-type': [
    'application/json',
    'application/xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'text/html',
    'text/xml',
    'application/octet-stream',
    'application/graphql',
    'application/ld+json',
  ],
  'cache-control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'max-age=3600',
    'must-revalidate',
    'private',
    'public',
  ],
  'connection': [
    'keep-alive',
    'close',
    'upgrade',
  ],
  'accept-encoding': [
    'gzip',
    'deflate',
    'br',
    'gzip, deflate, br',
    'identity',
    '*',
  ],
  'accept-language': [
    'en-US',
    'en-US,en;q=0.9',
    'en',
    '*',
  ],
  'pragma': [
    'no-cache',
  ],
  'transfer-encoding': [
    'chunked',
    'gzip',
    'deflate',
    'compress',
    'identity',
  ],
  'upgrade': [
    'websocket',
    'HTTP/2.0',
  ],
}

/** Returns value suggestions for a given header name, or undefined if none. */
export function getValueSuggestions(headerName: string): string[] | undefined {
  return HEADER_VALUE_SUGGESTIONS[headerName.toLowerCase()]
}
