// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { getSecretsConfig } from '../config';
import type { SecretProvider } from '../types';

// 1Password provider, using a 1Password Connect server and the standard secret
// reference syntax:
//   op://<vault>/<item>/<field>
//   op://<vault>/<item>/<section>/<field>
//
// Config: OP_CONNECT_HOST (the Connect server URL) + OP_CONNECT_TOKEN (a Connect
// access token). Vault and item may be given by name or id.

interface OpConn {
  host: string;
  token: string;
}

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function resolveConn(): OpConn {
  const cfg = getSecretsConfig()?.onePassword ?? {};
  const host = env('OP_CONNECT_HOST', 'API_SPECTOR_OP_CONNECT_HOST') ?? cfg.connectHost;
  const token = env('OP_CONNECT_TOKEN', 'API_SPECTOR_OP_CONNECT_TOKEN');
  if (!host || !token) {
    throw new Error('1Password: set OP_CONNECT_HOST and OP_CONNECT_TOKEN (1Password Connect)');
  }
  return { host: host.replace(/\/+$/, ''), token };
}

const itemCache = new Map<string, { fields: any[]; expiresAt: number }>();
const idCache = new Map<string, string>(); // "vaults:<name>" | "items:<vid>:<title>" -> id

export function _resetOnePasswordCache(): void {
  itemCache.clear();
  idCache.clear();
}

async function opGet(conn: OpConn, path: string): Promise<any> {
  const res = await fetch(`${conn.host}${path}`, { headers: { authorization: `Bearer ${conn.token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`1Password Connect ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const isId = (s: string) => /^[a-z0-9]{26}$/i.test(s);

async function vaultId(conn: OpConn, vault: string): Promise<string> {
  if (isId(vault)) return vault;
  const cacheKey = `vaults:${vault}`;
  const cached = idCache.get(cacheKey);
  if (cached) return cached;
  const list = await opGet(conn, `/v1/vaults?filter=${encodeURIComponent(`name eq "${vault}"`)}`);
  const id = Array.isArray(list) && list[0]?.id;
  if (!id) throw new Error(`1Password: vault '${vault}' not found`);
  idCache.set(cacheKey, id);
  return id;
}

async function itemId(conn: OpConn, vid: string, item: string): Promise<string> {
  if (isId(item)) return item;
  const cacheKey = `items:${vid}:${item}`;
  const cached = idCache.get(cacheKey);
  if (cached) return cached;
  const list = await opGet(conn, `/v1/vaults/${vid}/items?filter=${encodeURIComponent(`title eq "${item}"`)}`);
  const id = Array.isArray(list) && list[0]?.id;
  if (!id) throw new Error(`1Password: item '${item}' not found in vault`);
  idCache.set(cacheKey, id);
  return id;
}

async function resolve(refBody: string): Promise<string> {
  // refBody is the part after `op:` — i.e. `//<vault>/<item>/.../<field>`.
  const parts = refBody.replace(/^\/\//, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 3) {
    throw new Error(`1Password reference must be 'op://<vault>/<item>/<field>' (got 'op:${refBody}')`);
  }
  const [vault, item, ...rest] = parts;
  const sectionLabel = rest.length >= 2 ? rest[0] : null;
  const fieldLabel = rest[rest.length - 1];

  const conn = resolveConn();
  const vid = await vaultId(conn, vault);
  const iid = await itemId(conn, vid, item);

  const cacheKey = `${vid}/${iid}`;
  const now = Date.now();
  let fields: any[];
  const hit = itemCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    fields = hit.fields;
  } else {
    const doc = await opGet(conn, `/v1/vaults/${vid}/items/${iid}`);
    fields = Array.isArray(doc?.fields) ? doc.fields : [];
    itemCache.set(cacheKey, { fields, expiresAt: now + 5 * 60_000 });
  }

  const match = fields.find((f) => {
    const labelOk = String(f?.label ?? '').toLowerCase() === fieldLabel.toLowerCase() || f?.id === fieldLabel;
    if (!labelOk) return false;
    if (!sectionLabel) return true;
    return String(f?.section?.label ?? '').toLowerCase() === sectionLabel.toLowerCase();
  });

  if (!match || match.value === undefined) {
    throw new Error(`1Password: field '${fieldLabel}' not found on item '${item}'`);
  }
  return String(match.value);
}

export const onePasswordProvider: SecretProvider = {
  scheme: 'op',
  resolve: (refBody) => resolve(refBody),
};
