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

// ─── JSON Schema inferrer ─────────────────────────────────────────────────────
// Generates a JSON Schema (draft-07) from a sample value.
// Used by the Contract tab's "Infer from response" button.

export type JSONSchema = Record<string, unknown>

/**
 * Infer a JSON Schema from an arbitrary JavaScript value.
 * Arrays use the first element as a representative item schema.
 * All non-null object properties are added to `required`.
 */
export function inferSchema(data: unknown): JSONSchema {
  if (data === null || data === undefined) return { type: 'null' };

  if (typeof data === 'boolean') return { type: 'boolean' };

  if (typeof data === 'number') {
    return Number.isInteger(data) ? { type: 'integer' } : { type: 'number' };
  }

  if (typeof data === 'string') return { type: 'string' };

  if (Array.isArray(data)) {
    if (data.length === 0) return { type: 'array', items: {} };
    // Merge schemas of all elements for a more representative items schema
    return { type: 'array', items: inferSchema(data[0]) };
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      properties[key] = inferSchema(value);
      if (value !== null && value !== undefined) required.push(key);
    }

    const schema: JSONSchema = { type: 'object', properties };
    if (required.length > 0) schema['required'] = required;
    return schema;
  }

  return {};
}

/**
 * Parse a JSON string and infer a schema from it.
 * Returns null if the string is not valid JSON.
 */
export function inferSchemaFromJson(json: string): JSONSchema | null {
  try {
    return inferSchema(JSON.parse(json));
  } catch {
    return null;
  }
}
