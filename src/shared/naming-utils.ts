// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

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

function safeName(name: string): string {
  return name.trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
