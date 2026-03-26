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

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
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

/** Insert a snippet into a query string, before the last closing brace. */
function insertSnippet(query: string, snippet: string): string {
  const trimmed = query.trim();
  if (!trimmed) return `query {\n${snippet}\n}`;

  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace === -1) return trimmed + '\n' + snippet;

  return trimmed.slice(0, lastBrace).trimEnd() + '\n' + snippet + '\n' + trimmed.slice(lastBrace);
}

// ─── Introspection ────────────────────────────────────────────────────────────

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      name kind description
      fields(includeDeprecated: false) {
        name description
        type { kind name ofType { kind name ofType { kind name } } }
        args {
          name description
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }
  }
}`;

async function fetchSchema(url: string, extraHeaders: Record<string, string> = {}): Promise<ParsedSchema> {
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

  const typeMap = new Map<string, GqlType>();
  for (const t of schema.types as GqlType[]) {
    if (t.name && !t.name.startsWith('__')) typeMap.set(t.name, t);
  }

  return {
    queryType: schema.queryType?.name ?? null,
    mutationType: schema.mutationType?.name ?? null,
    subscriptionType: schema.subscriptionType?.name ?? null,
    typeMap,
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
  onInsert: (snippet: string) => void
}) {
  const [expanded, setExpanded] = useState(false);
  const baseTypeName = getBaseTypeName(field.type);
  const baseKind     = getBaseKind(field.type);
  const isObject     = baseKind === 'OBJECT' || baseKind === 'INTERFACE';
  const nestedType   = typeMap.get(baseTypeName);
  const hasChildren  = isObject && !!nestedType?.fields?.length;

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
        <FieldNode key={f.name} field={f} typeMap={typeMap} depth={depth + 1} onInsert={onInsert} />
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
  onInsert: (snippet: string) => void
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
  onInsert: (snippet: string) => void
}) {
  const [search, setSearch] = useState('');

  const filter = search.trim().toLowerCase();

  function filteredInsert(snippet: string) { onInsert(snippet); }

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

export function GraphQLEditor({ request, onChange }: Props) {
  const gql = request.body.graphql ?? { query: '', variables: '' };

  // For introspection hook: build plain env/collection/globals maps (renderer-side, no secret decryption)
  const hookVars = useStore(s => {
    const envId = s.activeEnvironmentId;
    const colId = s.activeCollectionId;
    const envVars: Record<string, string> = {};
    if (envId) {
      for (const v of s.environments[envId]?.data.variables ?? []) {
        if (v.enabled && v.key && !v.secret && !v.envRef) envVars[v.key] = v.value;
      }
    }
    const collectionVars: Record<string, string> =
      colId ? { ...(s.collections[colId]?.data.collectionVariables ?? {}) } : {};
    return { envVars, collectionVars, globals: { ...s.globals } };
  });

  const [schema,      setSchema]      = useState<ParsedSchema | null>(null);
  const [schemaState, setSchemaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [showVars,    setShowVars]    = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);

  function updateGql(patch: Partial<GraphQLBody>) {
    onChange({ body: { ...request.body, graphql: { ...gql, ...patch } } });
  }

  const handleInsert = useCallback((snippet: string) => {
    onChange({ body: { ...request.body, graphql: { ...gql, query: insertSnippet(gql.query, snippet) } } });
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
      const parsed = await fetchSchema(url, extraHeaders);
      setSchema(parsed);
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
            <CodeMirror
              value={gql.query}
              height="100%"
              theme={oneDark}
              extensions={[]}
              onChange={val => updateGql({ query: val })}
              placeholder="query {\n  # your query here\n}"
              basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true, autocompletion: false }}
            />
          </div>

          {/* Variables section */}
          <div className="flex-shrink-0">
            <button
              onClick={() => setShowVars(v => !v)}
              className="text-[10px] text-surface-600 hover:text-surface-300 uppercase tracking-wider font-medium flex items-center gap-1 mb-1"
            >
              <span>{showVars ? '▾' : '▸'}</span> Variables
              {gql.variables?.trim() && <span className="text-blue-400 ml-1">●</span>}
            </button>
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
