// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { fetch } from 'undici';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, ApiRequest, AuthConfig, RequestBody, KeyValuePair, Folder, RequestExample } from '../../shared/types';
import { normalizeHttpMethod } from '../../shared/types';

// OpenAPI 3.x importer

 

async function loadSpec(filePath: string): Promise<any> {
  const raw = await readFile(filePath, 'utf8');
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return yamlLoad(raw) as any;
  }
  return JSON.parse(raw);
}

async function loadSpecFromUrl(url: string): Promise<any> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const text = await resp.text();
  const ct   = resp.headers.get('content-type') ?? '';
  if (ct.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) {
    return yamlLoad(text) as any;
  }
  return JSON.parse(text);
}

function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/');
  return parts.reduce((obj, key) => obj?.[decodeURIComponent(key.replaceAll('~1', '/').replaceAll('~0', '~'))], spec);
}

function resolve(spec: any, obj: any, seen = new Set<any>()): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return {};           // circular ref
  if (Array.isArray(obj)) {
    seen.add(obj);
    return obj.map(item => resolve(spec, item, seen));
  }
  if ('$ref' in obj) {
    const target = resolveRef(spec, obj.$ref);
    if (!target || seen.has(target)) return {};
    return resolve(spec, target, seen);
  }
  seen.add(obj);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(spec, v, seen)]));
}

function schemaToExample(schema: any): any {
  if (!schema) return {};
  if ('example' in schema) return schema.example;
  if ('default' in schema) return schema.default;
  switch (schema.type) {
    case 'object': {
      const props = schema.properties ?? {};
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToExample(v)]));
    }
    case 'array':  return [schemaToExample(schema.items ?? {})];
    case 'string':  return 'string';
    case 'integer': return 0;
    case 'number':  return 0.0;
    case 'boolean': return true;
    default: return null;
  }
}

/** Best 2xx response schema as a pretty-printed JSON string, or undefined.
 *  Status preference: 200 -> 201 -> other 2xx -> 2XX range -> default; any JSON media type. */
function buildResponseSchema(operation: any, spec: any): string | undefined {
  const responses = operation.responses;
  if (!responses || typeof responses !== 'object') return undefined;

  const codes = Object.keys(responses);
  const ordered: string[] = [];
  if (codes.includes('200')) ordered.push('200');
  if (codes.includes('201')) ordered.push('201');
  codes.sort((a, b) => a.localeCompare(b));
  for (const code of codes) {
    if (/^2\d\d$/.test(code) && !ordered.includes(code)) ordered.push(code);
  }
  // range form, usually uppercase 2XX
  for (const code of codes) {
    if (/^2xx$/i.test(code) && !ordered.includes(code)) ordered.push(code);
  }
  if (codes.includes('default')) ordered.push('default');

  for (const code of ordered) {
    // Resolve fresh: a pre-resolved tree collapses repeated $refs to {}. The
    // response itself may be a $ref, so resolve before reading `.content`.
    const responseObj = resolve(spec, responses[code]);
    const content = responseObj?.content;
    if (!content || typeof content !== 'object') continue;

    // Walk media types in priority order, accepting anything JSON-ish.
    const mediaKeys = Object.keys(content);
    const jsonKey =
      mediaKeys.find(k => k.toLowerCase().split(';')[0].trim() === 'application/json') ??
      mediaKeys.find(k => /[+/]json(\b|;)/i.test(k)) ??
      mediaKeys.find(k => k.toLowerCase().includes('json'));
    if (!jsonKey) continue;

    const rawSchema = content[jsonKey]?.schema;
    if (!rawSchema) continue;
    const resolved = resolve(spec, rawSchema);
    if (!resolved || (typeof resolved === 'object' && Object.keys(resolved).length === 0)) continue;
    try {
      return JSON.stringify(resolved, null, 2);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function buildBody(rawOperation: any, params: any[], spec: any): RequestBody {
  // Resolve the whole requestBody fresh so a $ref body and repeated schema
  // $refs aren't collapsed to {}.
  const requestBody = resolve(spec, rawOperation?.requestBody ?? {}, new Set());
  const content = requestBody?.content ?? {};
  const jsonKey = Object.keys(content).find(k => k.includes('json'));
  if (jsonKey) {
    return { mode: 'json', json: JSON.stringify(schemaToExample(content[jsonKey].schema ?? {}), null, 2) };
  }

  // multipart/form-data: each property a part; binary format = file part, rest
  // = text fields seeded with an example.
  const multipartKey = Object.keys(content).find(k => k.toLowerCase().includes('multipart/form-data'));
  if (multipartKey) {
    const schema = resolve(spec, content[multipartKey].schema ?? {}, new Set());
    const props = (schema?.properties ?? {}) as Record<string, any>;
    const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
    const parts = Object.entries(props).map(([name, rawProp]) => {
      const prop = resolve(spec, rawProp, new Set());
      const isBinary = prop?.format === 'binary' || prop?.format === 'base64'
        || (prop?.type === 'array' && (resolve(spec, prop.items ?? {}, new Set())?.format === 'binary'));
      return isBinary
        ? { key: name, enabled: required.has(name), type: 'file' as const, filePath: '', ...(prop?.description ? { description: String(prop.description) } : {}) }
        : { key: name, enabled: required.has(name), type: 'text' as const, value: String(schemaToExample(prop ?? {}) ?? ''), ...(prop?.description ? { description: String(prop.description) } : {}) };
    });
    if (parts.length) return { mode: 'multipart', multipart: parts };
  }

  // Swagger 2.0: a single `in: body` parameter carries the schema.
  const bodyParam = params.find(p => p?.in === 'body');
  if (bodyParam) {
    const schema = resolve(spec, bodyParam.schema ?? {}, new Set());
    return { mode: 'json', json: JSON.stringify(schemaToExample(schema), null, 2) };
  }

  // Swagger 2.0 formData: multipart if any `type: file` param, else urlencoded.
  const formParams = params.filter(p => p?.in === 'formData');
  if (formParams.length) {
    if (formParams.some(p => p?.type === 'file')) {
      return {
        mode: 'multipart',
        multipart: formParams.map(p => (
          p?.type === 'file'
            ? { key: String(p.name ?? ''), enabled: p.required ?? false, type: 'file' as const, filePath: '', description: p.description ?? '' }
            : { key: String(p.name ?? ''), enabled: p.required ?? false, type: 'text' as const, value: String(schemaToExample(p.schema ?? p) ?? ''), description: p.description ?? '' }
        )),
      };
    }
    return {
      mode: 'form',
      form: formParams.map(p => ({
        key: String(p.name ?? ''),
        value: String(schemaToExample(p.schema ?? p) ?? ''),
        enabled: p.required ?? false,
        description: p.description ?? '',
      })),
    };
  }

  return { mode: 'none' };
}

/** Named example payloads -> one RequestExample per scenario name. OpenAPI keys
 *  `examples` by name on body and params; the same name = one scenario; undefined if none. */
function buildExamples(operation: any, spec: any, baseParams: KeyValuePair[], baseHeaders: KeyValuePair[], baseBody: RequestBody): RequestExample[] | undefined {
  const json = resolve(spec, operation.requestBody?.content ?? {})['application/json'];

  // Body examples: name -> value.
  const bodyExamples: Record<string, unknown> = {};
  if (json?.examples && typeof json.examples === 'object') {
    for (const [name, ex] of Object.entries<any>(json.examples)) {
      bodyExamples[name] = resolve(spec, ex)?.value;
    }
  }

  // Parameter examples: paramName -> (name -> value).
  const paramExamples: Record<string, Record<string, unknown>> = {};
  for (const p of (operation.parameters ?? [])) {
    if (!p?.name || (p.in !== 'query' && p.in !== 'path')) continue;
    if (p.examples && typeof p.examples === 'object') {
      paramExamples[p.name] = {};
      for (const [name, ex] of Object.entries<any>(p.examples)) {
        paramExamples[p.name][name] = resolve(spec, ex)?.value;
      }
    }
  }

  const names = new Set<string>([
    ...Object.keys(bodyExamples),
    ...Object.values(paramExamples).flatMap(m => Object.keys(m)),
  ]);
  if (names.size === 0) return undefined;

  const examples: RequestExample[] = [];
  for (const name of names) {
    // A full, runnable snapshot: fields the scenario names are overridden, the
    // rest captured from the base request.
    const body: RequestBody = (name in bodyExamples && bodyExamples[name] !== undefined)
      ? { mode: 'json', json: typeof bodyExamples[name] === 'string' ? String(bodyExamples[name]) : JSON.stringify(bodyExamples[name], null, 2) }
      : baseBody;

    const params = baseParams.some(pr => paramExamples[pr.key]?.[name] !== undefined)
      ? baseParams.map(pr => {
          const v = paramExamples[pr.key]?.[name];
          return v !== undefined ? { ...pr, value: v === null ? '' : String(v) } : pr;
        })
      : baseParams;

    examples.push({
      id: uuidv4(),
      name,
      request: { headers: baseHeaders, params, body },
      source: 'imported',
    });
  }

  return examples.length ? examples : undefined;
}

/** An `enum` as a list of stringified allowed values, or undefined. */
function enumChoices(schema: any): string[] | undefined {
  if (!schema || !Array.isArray(schema.enum) || !schema.enum.length) return undefined;
  return schema.enum
    .filter((v: unknown) => v !== null && v !== undefined)
    .map((v: unknown) => String(v));
}

function buildParams(operation: any): KeyValuePair[] {
  return (operation.parameters ?? [])
    .filter((p: any) => p.in === 'query')
    .map((p: any) => {
      // OpenAPI 3 nests the schema; Swagger 2.0 puts type/enum on the parameter.
      const schema = p.schema ?? p;
      const choices = enumChoices(schema);
      return {
        key: p.name,
        // enum defaults to its first value, else the usual example
        value: choices ? choices[0] : String(schemaToExample(schema) ?? ''),
        enabled: p.required ?? false,
        description: p.description ?? '',
        ...(choices ? { enum: choices } : {}),
      };
    });
}

/** Path-param rows tagged `paramType: 'path'` so buildUrl() interpolates them into
 *  the URL. Default preference: param example -> schema example/default -> first enum -> type placeholder. */
function buildPathParamRows(operation: any): KeyValuePair[] {
  return (operation.parameters ?? [])
    .filter((p: any) => p.in === 'path' && p.name)
    .map((p: any): KeyValuePair => {
      const schema = p.schema ?? p;
      let value: unknown;
      if (p.example !== undefined)        value = p.example;
      else if (schema.example !== undefined) value = schema.example;
      else if (schema.default !== undefined) value = schema.default;
      else if (Array.isArray(schema.enum) && schema.enum.length) value = schema.enum[0];
      else {
        switch (schema.type) {
          case 'integer':
          case 'number':  value = 1; break;
          case 'boolean': value = true; break;
          default:        value = '';
        }
      }
      const choices = enumChoices(schema);
      return {
        key:         String(p.name),
        value:       value === null || value === undefined ? '' : String(value),
        enabled:     true,
        description: p.description ?? '',
        paramType:   'path',
        ...(choices ? { enum: choices } : {}),
      };
    });
}

/** Rewrite OpenAPI path templates (`/users/{id}`) to interpolation syntax
 *  (`/users/{{id}}`). */
function rewritePathTemplate(url: string): string {
  return url.replaceAll(/\{([^/{}]+)\}/g, (_m, name) => `{{${name}}}`);
}

function buildHeaders(operation: any): KeyValuePair[] {
  return (operation.parameters ?? [])
    .filter((p: any) => p.in === 'header')
    .map((p: any) => ({
      key: p.name,
      value: '',
      enabled: true,
      description: p.description ?? '',
    }));
}

function buildAuth(security: any[], securitySchemes: any): AuthConfig {
  for (const req of security ?? []) {
    for (const schemeName of Object.keys(req)) {
      const scheme = securitySchemes[schemeName];
      if (!scheme) continue;
      if (scheme.type === 'http') {
        if (scheme.scheme === 'bearer') return { type: 'bearer', token: '' };
        if (scheme.scheme === 'basic')  return { type: 'basic', username: '', password: '' };
      }
      if (scheme.type === 'apiKey') {
        return {
          type: 'apikey',
          apiKeyName: scheme.name ?? 'X-API-Key',
          apiKeyValue: '',
          apiKeyIn: scheme.in ?? 'header',
        };
      }
    }
  }
  return { type: 'none' };
}

// 'query' is an OpenAPI 3.2+ operation (HTTP QUERY, RFC 10008)
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'query'] as const;

/** Base URL from OpenAPI 3 `servers` or Swagger 2.0 `schemes`/`host`/`basePath`.
 *  Inlined into each request URL so the import preview can offer to extract it. */
function resolveBaseUrl(spec: any): string {
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) return String(spec.servers[0].url).replace(/\/$/, '');
  if (spec.host) {
    const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || 'https';
    return `${scheme}://${spec.host}${spec.basePath ?? ''}`.replace(/\/$/, '');
  }
  return '';
}

function buildCollection(spec: any): Collection {
  const info = spec.info ?? {};
  const baseUrl: string = resolveBaseUrl(spec);
  const securitySchemes = resolve(spec, spec.components?.securitySchemes ?? {});
  const globalSecurity = spec.security ?? [];

  const requests: Record<string, ApiRequest> = {};
  const foldersByTag: Record<string, Folder> = {};
  // Top-level tag descriptions become folder docs.
  const tagDescriptions: Record<string, string> = {};
  for (const tg of (spec.tags ?? []) as { name?: string; description?: string }[]) {
    if (tg?.name && tg.description) tagDescriptions[tg.name] = tg.description;
  }

  for (const [pathStr, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    const resolved = resolve(spec, pathItem);

    for (const method of HTTP_METHODS) {
      const operation = resolved[method];
      if (!operation) continue;

      const tags: string[] = operation.tags?.length ? operation.tags : ['default'];
      const tag = tags[0];

      // Resolve each param with its own fresh seen set: the shared set on
      // `resolved` collapses a $ref shared by operations in this pathItem to {},
      // dropping repeated params.
      const rawOperation = pathItem[method] ?? {};
      const rawParams = [...(pathItem.parameters ?? []), ...(rawOperation.parameters ?? [])];
      const allParams = rawParams.map(p => resolve(spec, p, new Set()));
      const opWithParams = { ...operation, parameters: allParams };

      const security = operation.security ?? globalSecurity;
      // Path params first so they're the first thing on the Params tab.
      const params: KeyValuePair[] = [
        ...buildPathParamRows(opWithParams),
        ...buildParams(opWithParams),
      ];
      // Re-resolve from the raw operation (the resolved tree collapses repeat $refs).
      const responseSchema = buildResponseSchema(rawOperation, spec);
      const headers = buildHeaders(opWithParams);
      const body = buildBody(rawOperation, allParams, spec);
      const examples = buildExamples(opWithParams, spec, params, headers, body);
      const req: ApiRequest = {
        id: uuidv4(),
        name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${pathStr}`,
        method: normalizeHttpMethod(method),
        url: rewritePathTemplate(`${baseUrl}${pathStr}`),
        headers,
        params,
        auth: buildAuth(security, securitySchemes),
        body,
        description: operation.description || operation.summary || '',
        meta: { tags, ...(operation.operationId ? { operationId: String(operation.operationId) } : {}) },
        ...(responseSchema ? { schema: responseSchema } : {}),
        ...(examples ? { examples } : {}),
      };
      requests[req.id] = req;

      if (!foldersByTag[tag]) {
        foldersByTag[tag] = { id: uuidv4(), name: tag, description: tagDescriptions[tag] ?? '', folders: [], requestIds: [] };
      }
      foldersByTag[tag].requestIds.push(req.id);
    }
  }

  return {
    version: '1.0',
    id: uuidv4(),
    name: info.title ?? 'Imported API',
    description: info.description ?? '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: Object.values(foldersByTag), requestIds: [] },
    requests,
  };
}

export async function importOpenApi(filePath: string): Promise<Collection> {
  return buildCollection(await loadSpec(filePath));
}

export async function importOpenApiFromUrl(url: string): Promise<Collection> {
  return buildCollection(await loadSpecFromUrl(url));
}

// Schema extraction (for sync without re-import)

export interface SpecSchemaEntry {
  method: string                // uppercase
  pathTemplate: string          // raw OpenAPI path, e.g. /users/{id}
  /** Rewritten path as used in imported requests, e.g. /users/{{id}} */
  pathRewritten: string
  schema: string                // pretty-printed JSON Schema (response body)
  operationId?: string
  summary?: string
}

/** One entry per operation that has a JSON response schema. */
function extractSchemas(spec: any): SpecSchemaEntry[] {
  const entries: SpecSchemaEntry[] = [];
  for (const [pathStr, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const schema = buildResponseSchema(operation, spec);
      if (!schema) continue;
      entries.push({
        method:        method.toUpperCase(),
        pathTemplate:  pathStr,
        pathRewritten: rewritePathTemplate(pathStr),
        schema,
        operationId:   operation.operationId,
        summary:       operation.summary,
      });
    }
  }
  return entries;
}

export async function extractSchemasFromFile(filePath: string): Promise<SpecSchemaEntry[]> {
  return extractSchemas(await loadSpec(filePath));
}

export async function extractSchemasFromUrl(url: string): Promise<SpecSchemaEntry[]> {
  return extractSchemas(await loadSpecFromUrl(url));
}
