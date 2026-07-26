// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { HistoryEntry, RequestBody } from './types';

// ─── HAR 1.2 export ───────────────────────────────────────────────────────────
//
// Converts request/response history into the HTTP Archive (HAR) format, the
// standard interchange used by browser devtools, Charles, Insomnia, etc. Lets
// a session's traffic be saved and opened in any HAR viewer.
//
// Note: history stores the request DEFINITION plus the resolved URL and the
// received response, not the exact bytes sent (auth-injected headers are
// computed at send time and not captured). The HAR request is therefore
// reconstructed from the request definition, which is faithful for everything
// the user typed.

interface HarNameValue { name: string; value: string }

function enabledHeaders(headers: { key: string; value: string; enabled: boolean }[]): HarNameValue[] {
  return headers.filter(h => h.enabled && h.key).map(h => ({ name: h.key, value: h.value }));
}

function queryStringOf(url: string): HarNameValue[] {
  const q = url.indexOf('?');
  if (q === -1) return [];
  const out: HarNameValue[] = [];
  for (const pair of url.slice(q + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const name = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    try { out.push({ name: decodeURIComponent(name), value: decodeURIComponent(value) }); }
    catch { out.push({ name, value }); }
  }
  return out;
}

function postDataOf(body: RequestBody | undefined): { mimeType: string; text: string } | undefined {
  if (!body || body.mode === 'none') return undefined;
  switch (body.mode) {
    case 'json':    return body.json ? { mimeType: 'application/json', text: body.json } : undefined;
    case 'raw':     return body.raw ? { mimeType: body.rawContentType ?? 'text/plain', text: body.raw } : undefined;
    case 'graphql': return body.graphql ? { mimeType: 'application/json', text: JSON.stringify(body.graphql) } : undefined;
    case 'soap':    return body.soap ? { mimeType: 'text/xml', text: body.soap.envelope ?? '' } : undefined;
    case 'form': {
      const text = (body.form ?? [])
        .filter(p => p.enabled && p.key)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&');
      return { mimeType: 'application/x-www-form-urlencoded', text };
    }
    default: return undefined;
  }
}

/** Build a HAR 1.2 document from history entries (newest-first is fine; HAR has
 *  no ordering requirement). `creatorVersion` labels the export. */
export function historyToHar(entries: HistoryEntry[], creatorVersion = '1.0'): string {
  const harEntries = entries.map(e => {
    const post = postDataOf(e.request.body);
    const contentType = e.response.headers['content-type'] ?? e.response.headers['Content-Type'] ?? 'text/plain';
    return {
      startedDateTime: new Date(e.timestamp).toISOString(),
      time: e.response.durationMs,
      request: {
        method: e.request.method,
        url: e.resolvedUrl,
        httpVersion: 'HTTP/1.1',
        cookies: [] as HarNameValue[],
        headers: enabledHeaders(e.request.headers),
        queryString: queryStringOf(e.resolvedUrl),
        ...(post ? { postData: post } : {}),
        headersSize: -1,
        bodySize: post ? post.text.length : 0,
      },
      response: {
        status: e.response.status,
        statusText: e.response.statusText,
        httpVersion: 'HTTP/1.1',
        cookies: [] as HarNameValue[],
        headers: Object.entries(e.response.headers).map(([name, value]) => ({ name, value })),
        content: {
          size: e.response.bodySize,
          mimeType: contentType,
          text: e.response.body,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: e.response.bodySize,
      },
      cache: {},
      timings: { send: 0, wait: e.response.durationMs, receive: 0 },
      ...(e.environmentName ? { comment: `environment: ${e.environmentName}` } : {}),
    };
  });

  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'API Spector', version: creatorVersion },
      entries: harEntries,
    },
  }, null, 2);
}
