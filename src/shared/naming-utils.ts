// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

/**
 * Return a name that doesn't collide with `existing`, appending " (2)", " (3)", etc.
 */
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/** Derive a relative file path for a collection from its display name + id. */
export function colRelPath(name: string, id: string): string {
  const safe = safeName(name) || id.slice(0, 8);
  return `collections/${safe}.spector`;
}

/** Derive a relative file path for an environment from its display name + id. */
export function envRelPath(name: string, id: string): string {
  const safe = safeName(name) || id;
  return `environments/${safe}.env.json`;
}

/** Derive a relative file path for a flow from its display name + id. */
export function flowRelPath(name: string, id: string): string {
  const safe = safeName(name) || id.slice(0, 8);
  return `flows/${safe}.flow.json`;
}

function safeName(name: string): string {
  return name.trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^a-z0-9-_]/g, '')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
}
