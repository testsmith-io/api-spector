import { readFile } from 'fs/promises'
import { load as yamlLoad } from 'js-yaml'
import { fetch } from 'undici'
import { v4 as uuidv4 } from 'uuid'
import type { Collection, ApiRequest, AuthConfig, RequestBody, KeyValuePair, Folder } from '../../shared/types'

// ─── OpenAPI 3.x importer ─────────────────────────────────────────────────────

async function loadSpec(filePath: string): Promise<any> {
  const raw = await readFile(filePath, 'utf8')
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return yamlLoad(raw) as any
  }
  return JSON.parse(raw)
}

async function loadSpecFromUrl(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`)
  const text = await resp.text()
  const ct   = resp.headers.get('content-type') ?? ''
  if (ct.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) {
    return yamlLoad(text) as any
  }
  return JSON.parse(text)
}

function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/')
  return parts.reduce((obj, key) => obj?.[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))], spec)
}

function resolve(spec: any, obj: any, seen = new Set<any>()): any {
  if (!obj || typeof obj !== 'object') return obj
  if (seen.has(obj)) return {}           // circular — return empty object rather than looping
  if (Array.isArray(obj)) {
    seen.add(obj)
    return obj.map(item => resolve(spec, item, seen))
  }
  if ('$ref' in obj) {
    const target = resolveRef(spec, obj.$ref)
    if (!target || seen.has(target)) return {}
    return resolve(spec, target, seen)
  }
  seen.add(obj)
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(spec, v, seen)]))
}

function schemaToExample(schema: any): any {
  if (!schema) return {}
  if ('example' in schema) return schema.example
  if ('default' in schema) return schema.default
  switch (schema.type) {
    case 'object': {
      const props = schema.properties ?? {}
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToExample(v)]))
    }
    case 'array':  return [schemaToExample(schema.items ?? {})]
    case 'string':  return 'string'
    case 'integer': return 0
    case 'number':  return 0.0
    case 'boolean': return true
    default: return null
  }
}

function buildBody(operation: any, spec: any): RequestBody {
  const content = resolve(spec, operation.requestBody?.content ?? {})
  if ('application/json' in content) {
    const schema = resolve(spec, content['application/json'].schema ?? {})
    const example = schemaToExample(schema)
    return { mode: 'json', json: JSON.stringify(example, null, 2) }
  }
  return { mode: 'none' }
}

function buildParams(operation: any): KeyValuePair[] {
  return (operation.parameters ?? [])
    .filter((p: any) => p.in === 'query')
    .map((p: any) => ({
      key: p.name,
      value: String(schemaToExample(p.schema ?? {}) ?? ''),
      enabled: p.required ?? false,
      description: p.description ?? '',
    }))
}

function buildHeaders(operation: any): KeyValuePair[] {
  return (operation.parameters ?? [])
    .filter((p: any) => p.in === 'header')
    .map((p: any) => ({
      key: p.name,
      value: '',
      enabled: true,
      description: p.description ?? '',
    }))
}

function buildAuth(security: any[], securitySchemes: any): AuthConfig {
  for (const req of security ?? []) {
    for (const schemeName of Object.keys(req)) {
      const scheme = securitySchemes[schemeName]
      if (!scheme) continue
      if (scheme.type === 'http') {
        if (scheme.scheme === 'bearer') return { type: 'bearer', token: '' }
        if (scheme.scheme === 'basic')  return { type: 'basic', username: '', password: '' }
      }
      if (scheme.type === 'apiKey') {
        return {
          type: 'apikey',
          apiKeyName: scheme.name ?? 'X-API-Key',
          apiKeyValue: '',
          apiKeyIn: scheme.in ?? 'header',
        }
      }
    }
  }
  return { type: 'none' }
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

function buildCollection(spec: any): Collection {
  const info = spec.info ?? {}
  const servers: any[] = spec.servers ?? [{}]
  const baseUrl: string = servers[0]?.url ?? ''
  const securitySchemes = resolve(spec, spec.components?.securitySchemes ?? {})
  const globalSecurity = spec.security ?? []

  const requests: Record<string, ApiRequest> = {}
  const foldersByTag: Record<string, Folder> = {}

  for (const [pathStr, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    const resolved = resolve(spec, pathItem)
    const pathLevelParams = resolved.parameters ?? []

    for (const method of HTTP_METHODS) {
      const operation = resolved[method]
      if (!operation) continue

      const tags: string[] = operation.tags?.length ? operation.tags : ['default']
      const tag = tags[0]

      const allParams = [...pathLevelParams, ...(operation.parameters ?? [])]
      const opWithParams = { ...operation, parameters: allParams }

      const security = operation.security ?? globalSecurity
      const req: ApiRequest = {
        id: uuidv4(),
        name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${pathStr}`,
        method: method.toUpperCase() as any,
        url: `${baseUrl}${pathStr}`,
        headers: buildHeaders(opWithParams),
        params: buildParams(opWithParams),
        auth: buildAuth(security, securitySchemes),
        body: buildBody(opWithParams, spec),
        description: operation.description ?? '',
        meta: { tags },
      }
      requests[req.id] = req

      if (!foldersByTag[tag]) {
        foldersByTag[tag] = { id: uuidv4(), name: tag, description: '', folders: [], requestIds: [] }
      }
      foldersByTag[tag].requestIds.push(req.id)
    }
  }

  return {
    version: '1.0',
    id: uuidv4(),
    name: info.title ?? 'Imported API',
    description: info.description ?? '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: Object.values(foldersByTag), requestIds: [] },
    requests,
  }
}

export async function importOpenApi(filePath: string): Promise<Collection> {
  return buildCollection(await loadSpec(filePath))
}

export async function importOpenApiFromUrl(url: string): Promise<Collection> {
  return buildCollection(await loadSpecFromUrl(url))
}
