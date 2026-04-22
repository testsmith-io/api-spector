// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { buildClientSchema, parse as parseGql, print as printGql, type IntrospectionQuery } from 'graphql';
import { graphql as cm6Graphql } from 'cm6-graphql';
import type { ApiRequest, GraphQLBody } from '../../../../shared/types';
import { useStore } from '../../store';

// ─── Introspection types ──────────────────────────────────────────────────────

interface GqlTypeRef {
  kind: string
  name: string | null
  ofType: GqlTypeRef | null
}

interface GqlArg {
  name: string
  type: GqlTypeRef
  description?: string | null
}

interface GqlField {
  name: string
  type: GqlTypeRef
  args: GqlArg[]
  description?: string | null
}

interface GqlType {
  name: string
  kind: string
  description?: string | null
  fields: GqlField[] | null
}

interface ParsedSchema {
  queryType: string | null
  mutationType: string | null
  subscriptionType: string | null
  typeMap: Map<string, GqlType>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayType(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL') return displayType(ref.ofType) + '!';
  if (ref.kind === 'LIST') return '[' + displayType(ref.ofType) + ']';
  return ref.name ?? '';
}

function getBaseTypeName(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL' || ref.kind === 'LIST') return getBaseTypeName(ref.ofType);
  return ref.name ?? '';
}

function getBaseKind(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL' || ref.kind === 'LIST') return getBaseKind(ref.ofType);
  return ref.kind;
}

function isLeafKind(kind: string): boolean {
  return kind === 'SCALAR' || kind === 'ENUM';
}

/** Build a smart field snippet: scalars → plain name, objects → name { <first scalars> } */
function buildSnippet(field: GqlField, typeMap: Map<string, GqlType>): string {
  const baseTypeName = getBaseTypeName(field.type);
  const baseKind     = getBaseKind(field.type);
  const type         = typeMap.get(baseTypeName);

  const args = field.args.length > 0
    ? `(${field.args.map(a => `${a.name}: $${a.name}`).join(', ')})`
    : '';

  if ((baseKind === 'OBJECT' || baseKind === 'INTERFACE') && type?.fields?.length) {
    const leaves = type.fields
      .filter(f => isLeafKind(getBaseKind(f.type)))
      .slice(0, 4)
      .map(f => `    ${f.name}`)
      .join('\n');
    return `  ${field.name}${args} {\n${leaves || '    # fields'}\n  }`;
  }
  return `  ${field.name}${args}`;
}

/**
 * Insert a snippet into a query string.
 *
 * When `parentField` is given (e.g. "category"), the function first tries to
 * find an existing `category {` block in the query and inserts inside it. If
 * no such block exists, it creates `category {\n  <snippet>\n}` and inserts
 * that at the deepest level.
 *
 * When no `parentField` is given, inserts at the deepest `{ }` block (for
 * root-level fields).
 *
 * If the query is empty, wraps in `query { … }`.
 */
function insertSnippet(query: string, snippet: string, parentField?: string): string {
  const trimmed = query.trim();
  if (!trimmed) return `query {\n${snippet}\n}`;

  // If we have a parentField, try to find its existing `{ }` block
  if (parentField) {
    // Match `parentField {` or `parentField(args) {` — find the opening brace
    const regex = new RegExp(`\\b${parentField}\\b(?:\\s*\\([^)]*\\))?\\s*\\{`);
    const match = regex.exec(trimmed);
    if (match) {
      // Found existing block — find its closing brace by counting braces
      const openPos = match.index + match[0].length;
      let depth = 1;
      let closePos = -1;
      for (let i = openPos; i < trimmed.length; i++) {
        if (trimmed[i] === '{') depth++;
        else if (trimmed[i] === '}') {
          depth--;
          if (depth === 0) { closePos = i; break; }
        }
      }
      if (closePos !== -1) {
        // Count the nesting depth at the insertion point for indentation
        let nestDepth = 0;
        for (let i = 0; i < closePos; i++) {
          if (trimmed[i] === '{') nestDepth++;
          else if (trimmed[i] === '}') nestDepth--;
        }
        const indent = '  '.repeat(nestDepth);
        // Re-indent all lines of the snippet, not just the first
        const reindented = snippet
          .split('\n')
          .map(line => indent + line.trim())
          .filter(line => line.trim())
          .join('\n');
        return trimmed.slice(0, closePos).trimEnd() + '\n' + reindented + '\n' + '  '.repeat(nestDepth - 1) + trimmed.slice(closePos);
      }
    }

    // No existing block found — wrap the snippet and fall through to
    // insert the wrapped block at the deepest level
    snippet = `  ${parentField} {\n  ${snippet}\n  }`;
  }

  // Find the deepest `{ }` block and insert before its closing brace
  let maxDepth = 0;
  let depth = 0;
  let insertPos = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === '}') {
      if (depth === maxDepth && insertPos === -1) {
        insertPos = i;
      }
      depth--;
    }
  }

  if (insertPos === -1) return trimmed + '\n' + snippet;

  const depthAtInsert = maxDepth;
  const indent = '  '.repeat(depthAtInsert);
  const reindented = snippet
    .split('\n')
    .map(line => {
      const stripped = line.replace(/^ {0,2}/, '');
      return indent + stripped;
    })
    .join('\n');

  return trimmed.slice(0, insertPos).trimEnd() + '\n' + reindented + '\n' + '  '.repeat(depthAtInsert - 1) + trimmed.slice(insertPos);
}

// ─── Introspection ────────────────────────────────────────────────────────────

// 7 levels of ofType unwrapping covers types like [[String!]!]! which needs 5,
// plus some margin. buildClientSchema throws if the chain is truncated.
const TYPE_REF = `kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }`;

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      name kind description
      fields(includeDeprecated: false) {
        name description
        type { ${TYPE_REF} }
        args {
          name description
          type { ${TYPE_REF} }
        }
      }
    }
  }
}`;

interface FetchSchemaResult {
  parsed: ParsedSchema
  /** Raw introspection JSON for caching + building the full GraphQLSchema. */
  rawIntrospection: IntrospectionQuery
}

function parseIntrospection(rawData: { __schema: unknown }): ParsedSchema {
  const schema = rawData.__schema as Record<string, unknown>;
  const typeMap = new Map<string, GqlType>();
  for (const t of (schema.types ?? []) as GqlType[]) {
    if (t.name && !t.name.startsWith('__')) typeMap.set(t.name, t);
  }
  return {
    queryType: (schema.queryType as { name: string } | null)?.name ?? null,
    mutationType: (schema.mutationType as { name: string } | null)?.name ?? null,
    subscriptionType: (schema.subscriptionType as { name: string } | null)?.name ?? null,
    typeMap,
  };
}

async function fetchSchemaFromUrl(url: string, extraHeaders: Record<string, string> = {}): Promise<FetchSchemaResult> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });
  const data = await resp.json();
  const schema = data?.data?.__schema;
  if (!schema) {
    const msg = data?.errors?.[0]?.message ?? 'Invalid introspection response';
    throw new Error(msg);
  }
  return {
    parsed: parseIntrospection(data.data),
    rawIntrospection: data.data as IntrospectionQuery,
  };
}

// ─── Schema explorer components ──────────────────────────────────────────────

function FieldNode({
  field,
  typeMap,
  depth,
  onInsert,
}: {
  field: GqlField
  typeMap: Map<string, GqlType>
  depth: number
  onInsert: (snippet: string, parentField?: string) => void
}) {
  const [expanded, setExpanded] = useState(false);
  const baseTypeName = getBaseTypeName(field.type);
  const baseKind     = getBaseKind(field.type);
  const isObject     = baseKind === 'OBJECT' || baseKind === 'INTERFACE';
  const nestedType   = typeMap.get(baseTypeName);
  const hasChildren  = isObject && !!nestedType?.fields?.length;

  // When a child field is clicked, pass it up with the parent context.
  // If the child already carries a parentField (from a deeper nesting level),
  // pass it through unchanged — the deeper child knows which block it needs.
  // Only set this field's name as parentField if the child didn't provide one
  // (i.e. the child is a direct leaf of this field).
  const childInsert = useCallback((childSnippet: string, childParent?: string) => {
    onInsert(childSnippet, childParent ?? field.name);
  }, [field.name, onInsert]);

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-0.5 hover:bg-surface-800/60 group rounded cursor-default"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={field.description ?? undefined}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-surface-600 hover:text-surface-300 w-3 text-[10px] leading-none flex-shrink-0"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        <span className="text-emerald-400 text-[11px] font-medium flex-1 truncate">{field.name}</span>

        {field.args.length > 0 && (
          <span className="text-surface-600 text-[10px] truncate max-w-[60px]" title={field.args.map(a => a.name).join(', ')}>
            ({field.args.map(a => a.name).join(', ')})
          </span>
        )}

        <span className="text-blue-400/60 text-[10px] truncate max-w-[64px] ml-1">
          {displayType(field.type)}
        </span>

        <button
          onClick={() => onInsert(buildSnippet(field, typeMap))}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-600 hover:text-blue-400 px-1 transition-opacity ml-1 flex-shrink-0"
          title="Insert into query"
        >
          +
        </button>
      </div>

      {expanded && hasChildren && nestedType!.fields!.map(f => (
        <FieldNode key={f.name} field={f} typeMap={typeMap} depth={depth + 1} onInsert={childInsert} />
      ))}
    </div>
  );
}

function RootTypeSection({
  label,
  typeName,
  typeMap,
  onInsert,
}: {
  label: string
  typeName: string
  typeMap: Map<string, GqlType>
  onInsert: (snippet: string, parentField?: string) => void
}) {
  const [expanded, setExpanded] = useState(true);
  const type = typeMap.get(typeName);
  if (!type?.fields?.length) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500 hover:text-surface-300 transition-colors"
      >
        <span className="text-[9px]">{expanded ? '▾' : '▸'}</span>
        {label}
        <span className="text-surface-400 normal-case tracking-normal font-normal ml-auto">{type.fields.length} fields</span>
      </button>
      {expanded && type.fields.map(f => (
        <FieldNode key={f.name} field={f} typeMap={typeMap} depth={0} onInsert={onInsert} />
      ))}
    </div>
  );
}

function SchemaExplorer({
  schema,
  onInsert,
}: {
  schema: ParsedSchema
  onInsert: (snippet: string, parentField?: string) => void
}) {
  const [search, setSearch] = useState('');

  const filter = search.trim().toLowerCase();

  function filteredInsert(snippet: string, parentField?: string) { onInsert(snippet, parentField); }

  // When searching, show a flat filtered list across all root type fields
  const rootTypeNames = [schema.queryType, schema.mutationType, schema.subscriptionType].filter(Boolean) as string[];

  const allFields: { rootLabel: string; field: GqlField }[] = [];
  if (filter) {
    for (const typeName of rootTypeNames) {
      const type = schema.typeMap.get(typeName);
      const label = typeName === schema.queryType ? 'Query'
        : typeName === schema.mutationType ? 'Mutation' : 'Subscription';
      for (const f of type?.fields ?? []) {
        if (f.name.toLowerCase().includes(filter)) allFields.push({ rootLabel: label, field: f });
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b border-surface-800 flex-shrink-0">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search fields…"
          className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[11px] focus:outline-none focus:border-blue-500 placeholder-surface-700"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filter ? (
          allFields.length > 0 ? allFields.map(({ rootLabel, field }) => (
            <div key={`${rootLabel}-${field.name}`}>
              <FieldNode field={field} typeMap={schema.typeMap} depth={0} onInsert={filteredInsert} />
            </div>
          )) : (
            <p className="text-[11px] text-surface-400 px-3 py-4 text-center">No fields match "{search}"</p>
          )
        ) : (
          <>
            {schema.queryType && (
              <RootTypeSection label="Query" typeName={schema.queryType} typeMap={schema.typeMap} onInsert={onInsert} />
            )}
            {schema.mutationType && (
              <RootTypeSection label="Mutation" typeName={schema.mutationType} typeMap={schema.typeMap} onInsert={onInsert} />
            )}
            {schema.subscriptionType && (
              <RootTypeSection label="Subscription" typeName={schema.subscriptionType} typeMap={schema.typeMap} onInsert={onInsert} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── GraphQL Editor ───────────────────────────────────────────────────────────

interface Props {
  request: ApiRequest
  onChange: (p: Partial<ApiRequest>) => void
}

const EMPTY_GQL: GraphQLBody = { query: '', variables: '' };

export function GraphQLEditor({ request, onChange }: Props) {
  const gql = useMemo(
    () => request.body.graphql ?? EMPTY_GQL,
    [request.body.graphql],
  );

  // For introspection hook: build plain env/collection/globals maps.
  // Read reactively from the store so edits to variables are picked up
  // without needing to switch environments.
  const activeEnvironmentId = useStore(s => s.activeEnvironmentId);
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  const envData        = useStore(s => activeEnvironmentId ? s.environments[activeEnvironmentId]?.data : null);
  const colVarsData    = useStore(s => activeCollectionId ? s.collections[activeCollectionId]?.data.collectionVariables : null);
  const globals        = useStore(s => s.globals);
  const hookVars = useMemo(() => {
    const envVars: Record<string, string> = {};
    if (envData) {
      for (const v of envData.variables) {
        if (v.enabled && v.key && !v.secret && !v.envRef) envVars[v.key] = v.value;
      }
    }
    const collectionVars: Record<string, string> = colVarsData ? { ...colVarsData } : {};
    return { envVars, collectionVars, globals: { ...globals } };
  }, [envData, colVarsData, globals]);

  const [schema,      setSchema]      = useState<ParsedSchema | null>(null);
  const [schemaState, setSchemaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [showVars,    setShowVars]    = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);

  // Build a full GraphQLSchema for CM6 autocomplete from the cached or
  // freshly-fetched introspection result.
  const gqlSchema = useMemo(() => {
    const raw = request.graphqlIntrospectionCache;
    if (!raw) return null;
    try {
      return buildClientSchema(JSON.parse(raw) as IntrospectionQuery);
    } catch {
      return null;
    }
  }, [request.graphqlIntrospectionCache]);

  // CM6 extension for GraphQL syntax highlighting + autocomplete.
  // Memoised with a stable reference so CodeMirror doesn't reconfigure
  // on every render.
  const gqlExtension = useMemo(() => {
    if (!gqlSchema) return [];
    try {
      return [cm6Graphql(gqlSchema)];
    } catch {
      return [];
    }
  }, [gqlSchema]);

  // Restore the schema explorer from cache when the request changes (tab
  // switch) or when the cache is first populated after a fetch.
  useEffect(() => {
    if (request.graphqlIntrospectionCache) {
      try {
        const data = JSON.parse(request.graphqlIntrospectionCache) as { __schema: unknown };
        setSchema(parseIntrospection(data));
      } catch {
        setSchema(null);
      }
    } else {
      setSchema(null);
    }
  }, [request.graphqlIntrospectionCache, request.id]);

  function updateGql(patch: Partial<GraphQLBody>) {
    onChange({ body: { ...request.body, graphql: { ...gql, ...patch } } });
  }

  const handleInsert = useCallback((snippet: string, parentField?: string) => {
    onChange({ body: { ...request.body, graphql: { ...gql, query: insertSnippet(gql.query, snippet, parentField) } } });
  }, [gql, onChange, request.body]);

  async function loadSchema() {
    const url = request.url.trim();
    if (!url) return;
    setSchemaState('loading');
    setSchemaError(null);
    try {
      // Run introspection hook if defined — can inject auth headers via sp.environment.set()
      let resolvedVars = { ...hookVars.envVars, ...hookVars.collectionVars, ...hookVars.globals };
      if (request.graphqlIntrospectionScript?.trim()) {
        try {
          const hookResult = await window.electron.runScriptHook({
            script:         request.graphqlIntrospectionScript,
            envVars:        hookVars.envVars,
            collectionVars: hookVars.collectionVars,
            globals:        hookVars.globals,
          });
          resolvedVars = {
            ...hookResult.updatedEnvVars,
            ...hookResult.updatedCollectionVars,
            ...hookResult.updatedGlobals,
          };
        } catch {
          // Hook errors are non-fatal — introspection continues with original vars
        }
      }

      // Include any enabled request headers, interpolating {{vars}}
      const extraHeaders: Record<string, string> = {};
      for (const h of request.headers) {
        if (h.enabled && h.key) {
          const key = h.key.replace(/\{\{([^}]+)\}\}/g, (_, k) => resolvedVars[k.trim()] ?? '');
          const val = h.value.replace(/\{\{([^}]+)\}\}/g, (_, k) => resolvedVars[k.trim()] ?? '');
          extraHeaders[key] = val;
        }
      }
      const { parsed, rawIntrospection } = await fetchSchemaFromUrl(url, extraHeaders);
      setSchema(parsed);
      // Cache the raw introspection on the request so it persists across tab
      // switches and app restarts, and feeds CM6 autocomplete.
      onChange({ graphqlIntrospectionCache: JSON.stringify(rawIntrospection) });
      setSchemaState('idle');
      setShowExplorer(true);
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : String(e));
      setSchemaState('error');
    }
  }

  const hasSchema = !!schema;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-2 pb-2 flex-shrink-0 flex-wrap">
        <input
          value={gql.operationName ?? ''}
          onChange={e => updateGql({ operationName: e.target.value })}
          placeholder="operationName (optional)"
          className="bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-500 placeholder-surface-700 w-44"
        />

        <button
          onClick={loadSchema}
          disabled={schemaState === 'loading' || !request.url.trim()}
          className="px-2.5 py-0.5 text-[11px] bg-surface-800 hover:bg-surface-700 disabled:text-surface-400 rounded transition-colors"
        >
          {schemaState === 'loading' ? 'Loading…' : 'Fetch schema'}
        </button>

        {schemaError && (
          <span className="text-[11px] text-red-400 truncate max-w-xs" title={schemaError}>⚠ {schemaError}</span>
        )}

        {hasSchema && (
          <button
            onClick={() => setShowExplorer(v => !v)}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ml-auto ${
              showExplorer ? 'bg-blue-700 text-white' : 'bg-surface-800 hover:bg-surface-700'
            }`}
          >
            Explorer
          </button>
        )}
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0 gap-2">
        {/* Schema explorer */}
        {hasSchema && showExplorer && (
          <div className="w-56 flex-shrink-0 border border-surface-700 rounded overflow-hidden flex flex-col">
            <div className="px-2 py-1 border-b border-surface-800 flex-shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-600">Schema</span>
            </div>
            <SchemaExplorer schema={schema!} onInsert={handleInsert} />
          </div>
        )}

        {/* Right: query + variables */}
        <div className="flex-1 flex flex-col min-h-0 gap-2">
          {/* Query editor */}
          <div className="flex-1 min-h-0 rounded overflow-hidden border border-surface-700">
            <div className="flex justify-end px-2 py-0.5 bg-surface-800/50 border-b border-surface-700">
              <button
                onClick={() => {
                  try {
                    // Temporarily replace {{var}} tokens so parseGql doesn't choke
                    const vars: string[] = [];
                    const safe = gql.query.replace(/\{\{([^}]+)\}\}/g, (_m, v) => {
                      vars.push(v);
                      return `__TPL${vars.length - 1}__`;
                    });
                    let formatted = printGql(parseGql(safe));
                    // Restore {{var}} tokens
                    formatted = formatted.replace(/__TPL(\d+)__/g, (_m, i) => `{{${vars[Number(i)]}}}`);
                    updateGql({ query: formatted });
                  } catch { /* invalid query */ }
                }}
                className="text-[10px] text-surface-500 hover:text-white transition-colors"
                title="Format GraphQL query (comments will not be preserved)"
              >
                Format
              </button>
            </div>
            <CodeMirror
              value={gql.query}
              height="100%"
              theme={oneDark}
              extensions={gqlExtension}
              onChange={val => updateGql({ query: val })}
              placeholder="query {\n  # your query here\n}"
              basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, autocompletion: !gqlSchema }}
            />
          </div>

          {/* Variables section */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => setShowVars(v => !v)}
                className="text-[10px] text-surface-600 hover:text-surface-300 uppercase tracking-wider font-medium flex items-center gap-1"
              >
                <span>{showVars ? '▾' : '▸'}</span> Variables
                {gql.variables?.trim() && <span className="text-blue-400 ml-1">●</span>}
              </button>
              {showVars && gql.variables?.trim() && (
                <button
                  onClick={() => {
                    try { updateGql({ variables: JSON.stringify(JSON.parse(gql.variables), null, 2) }); } catch { /* invalid json */ }
                  }}
                  className="text-[10px] text-surface-500 hover:text-white transition-colors"
                  title="Format JSON variables"
                >
                  Format
                </button>
              )}
            </div>
            {showVars && (
              <div className="rounded overflow-hidden border border-surface-700" style={{ height: 100 }}>
                <CodeMirror
                  value={gql.variables}
                  height="100px"
                  theme={oneDark}
                  extensions={[json()]}
                  onChange={val => updateGql({ variables: val })}
                  placeholder='{"id": "123"}'
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
