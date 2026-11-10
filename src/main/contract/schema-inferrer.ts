// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// JSON Schema inferrer
// Generates a JSON Schema (draft-07) from a sample value.
// Used by the Contract tab's "Infer from response" button.

export type JSONSchema = Record<string, unknown>

/** Infer a JSON Schema from a value. Arrays use the first element as the item
 *  schema; all non-null object properties go in `required`. */
export function inferSchema(data: unknown): JSONSchema {
  if (data === null || data === undefined) return { type: 'null' };

  if (typeof data === 'boolean') return { type: 'boolean' };

  if (typeof data === 'number') {
    return Number.isInteger(data) ? { type: 'integer' } : { type: 'number' };
  }

  if (typeof data === 'string') return { type: 'string' };

  if (Array.isArray(data)) {
    if (data.length === 0) return { type: 'array', items: {} };
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

/** Parse a JSON string and infer a schema, or null if invalid JSON. */
export function inferSchemaFromJson(json: string): JSONSchema | null {
  try {
    return inferSchema(JSON.parse(json));
  } catch {
    return null;
  }
}
