// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import Ajv from 'ajv';

// Shared JSON-Schema validation used by the request Schema tab and the
// response viewer's auto-check badge, so both agree on results and errors.
const ajv = new Ajv({ allErrors: true, strict: false });

export interface SchemaError {
  instancePath: string
  message?: string
}

export type SchemaValidation =
  | { status: 'valid' }
  | { status: 'invalid'; errors: SchemaError[] }
  | { status: 'error'; message: string }

/** Validate a response body string against a JSON Schema string. Returns a
 *  discriminated result so callers can render pass / fail / not-applicable
 *  without throwing. `schema`/`body` that are empty yield an 'error' status
 *  with an explanatory message. */
export function validateBodyAgainstSchema(schema: string, body: string | null | undefined): SchemaValidation {
  if (!schema.trim()) return { status: 'error', message: 'No schema defined.' };
  if (body == null) return { status: 'error', message: 'No response body to validate.' };

  let parsedSchema: unknown;
  try {
    parsedSchema = JSON.parse(schema);
  } catch {
    return { status: 'error', message: 'Schema is not valid JSON.' };
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { status: 'error', message: 'Response body is not valid JSON.' };
  }

  try {
    const validate = ajv.compile(parsedSchema as object);
    const valid = validate(data);
    if (valid) return { status: 'valid' };
    return {
      status: 'invalid',
      errors: (validate.errors ?? []).map(e => ({ instancePath: e.instancePath, message: e.message })),
    };
  } catch (e: unknown) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
