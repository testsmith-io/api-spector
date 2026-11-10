// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Import a Postman environment export (not a Collection) into EnvVariables. Postman
// stores secrets inline, so they import as plain values; the user can re-mark them secret.

import { readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Environment, EnvVariable } from '../../shared/types';

interface PostmanEnvValue {
  key?: string
  value?: unknown
  type?: string
  enabled?: boolean
}

interface PostmanEnvFile {
  name?: string
  values?: PostmanEnvValue[]
  _postman_variable_scope?: string
}

export async function importPostmanEnvironment(filePath: string): Promise<Environment> {
  const raw = await readFile(filePath, 'utf8');
  let data: PostmanEnvFile;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Not valid JSON — pick a Postman environment export file.');
  }

  // Guard against a Postman collection: environment exports carry a `values`
  // array, and usually the scope marker.
  if (!Array.isArray(data.values) || data._postman_variable_scope === 'collection') {
    throw new Error('Not a Postman environment file (no "values" array found).');
  }

  const variables: EnvVariable[] = data.values
    .filter((v): v is PostmanEnvValue => !!v && typeof v.key === 'string' && v.key.length > 0)
    .map(v => ({
      key: v.key as string,
      value: v.value == null ? '' : String(v.value),
      enabled: v.enabled !== false,
    }));

  return {
    version: '1.0',
    id: uuidv4(),
    name: (data.name && String(data.name).trim()) || 'Imported Environment',
    variables,
  };
}
