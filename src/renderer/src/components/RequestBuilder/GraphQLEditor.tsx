// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { buildClientSchema, parse as parseGql, print as printGql, type IntrospectionQuery } from 'graphql';
import { graphql as cm6Graphql } from 'cm6-graphql';
import type { ApiRequest, GraphQLBody } from '../../../../shared/types';
import { useStore } from '../../store';
import { useActiveEnvironment } from '../../hooks/useActiveEnvironment';
import {
  type GqlField,
  type GqlType,
  type ParsedSchema,
  displayType,
  getBaseTypeName,
  getBaseKind,
  argRequired,
  parseIntrospection,
  fetchSchemaFromUrl,
} from '../../lib/graphql-introspection';
import { insertField, validateQuery, type OperationType } from '../../lib/graphql-query-builder';

type InsertHandler = (field: GqlField, path: string[], opType: OperationType, allFields?: boolean) => void;

function opTypeForLabel(label: string): OperationType {
  return label === 'Mutation' ? 'mutation' : label === 'Subscription' ? 'subscription' : 'query';
}

// ─── Schema explorer components ──────────────────────────────────────────────

function FieldNode({
  field,
  typeMap,
  depth,
  path,
  opType,
  onInsert,
}: {
  field: GqlField
  typeMap: Map<string, GqlType>
  depth: number
  /** Ancestor field names from the operation root to this field's parent. */
  path: string[]
  opType: OperationType
  onInsert: InsertHandler
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

        {field.args.length > 0 && (() => {
          const hasRequired = field.args.some(argRequired);
          // Required args get a trailing ! so it's clear the field needs input
          // (e.g. brand(id!) vs brands()).
          const label = field.args.map(a => a.name + (argRequired(a) ? "!" : "")).join(', ');
          const full = field.args.map(a => `${a.name}: ${displayType(a.type)}`).join(', ');
          return (
            <span className={`text-[10px] truncate max-w-[70px] ${hasRequired ? 'text-amber-500/80' : 'text-surface-600'}`} title={full}>
              ({label})
            </span>
          );
        })()}

        <span className="text-blue-400/60 text-[10px] truncate max-w-[64px] ml-1">
          {displayType(field.type)}
        </span>

        {hasChildren && (
          <button
            onClick={() => onInsert(field, path, opType, true)}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-600 hover:text-blue-400 px-1 transition-opacity flex-shrink-0"
            title="Insert with all of this type's fields"
          >
            all
          </button>
        )}
        <button
          onClick={() => onInsert(field, path, opType)}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-surface-600 hover:text-blue-400 px-1 transition-opacity ml-0.5 flex-shrink-0"
          title="Insert into query"
        >
          +
        </button>
      </div>

      {expanded && hasChildren && nestedType!.fields!.map(f => (
        <FieldNode key={f.name} field={f} typeMap={typeMap} depth={depth + 1} path={[...path, field.name]} opType={opType} onInsert={onInsert} />
      ))}
    </div>
  );
}

function RootTypeSection({
  label,
  typeName,
  typeMap,
  listOnly,
  onInsert,
}: {
  label: string
  typeName: string
  typeMap: Map<string, GqlType>
  /** Hide root fields that require an argument (the by-id lookups), leaving the
   *  list/collection fields. */
  listOnly: boolean
  onInsert: InsertHandler
}) {
  const [expanded, setExpanded] = useState(true);
  const type = typeMap.get(typeName);
  const opType = opTypeForLabel(label);
  const fields = (type?.fields ?? []).filter(f => !listOnly || !f.args.some(argRequired));
  if (!fields.length) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500 hover:text-surface-300 transition-colors"
      >
        <span className="text-[9px]">{expanded ? '▾' : '▸'}</span>
        {label}
        <span className="text-surface-400 normal-case tracking-normal font-normal ml-auto">{fields.length} fields</span>
      </button>
      {expanded && fields.map(f => (
        <FieldNode key={f.name} field={f} typeMap={typeMap} depth={0} path={[]} opType={opType} onInsert={onInsert} />
      ))}
    </div>
  );
}

function SchemaExplorer({
  schema,
  onInsert,
}: {
  schema: ParsedSchema
  onInsert: InsertHandler
}) {
  const [search, setSearch] = useState('');
  const [listOnly, setListOnly] = useState(false);

  const filter = search.trim().toLowerCase();
  const passesListOnly = (f: GqlField) => !listOnly || !f.args.some(argRequired);

  // When searching, show a flat filtered list across all root type fields
  const rootTypeNames = [schema.queryType, schema.mutationType, schema.subscriptionType].filter(Boolean) as string[];

  const allFields: { rootLabel: string; field: GqlField }[] = [];
  if (filter) {
    for (const typeName of rootTypeNames) {
      const type = schema.typeMap.get(typeName);
      const label = typeName === schema.queryType ? 'Query'
        : typeName === schema.mutationType ? 'Mutation' : 'Subscription';
      for (const f of type?.fields ?? []) {
        if (f.name.toLowerCase().includes(filter) && passesListOnly(f)) allFields.push({ rootLabel: label, field: f });
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 py-1.5 border-b border-surface-800 flex-shrink-0 flex flex-col gap-1">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search fields…"
          className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-[11px] focus:outline-none focus:border-blue-500 placeholder-surface-700"
        />
        <label className="flex items-center gap-1 text-[10px] text-surface-500 cursor-pointer" title="Hide the by-id lookups (e.g. product(id!)); show list/collection fields">
          <input type="checkbox" checked={listOnly} onChange={e => setListOnly(e.target.checked)} />
          Hide fields that require arguments
        </label>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filter ? (
          allFields.length > 0 ? allFields.map(({ rootLabel, field }) => (
            <div key={`${rootLabel}-${field.name}`}>
              <FieldNode field={field} typeMap={schema.typeMap} depth={0} path={[]} opType={opTypeForLabel(rootLabel)} onInsert={onInsert} />
            </div>
          )) : (
            <p className="text-[11px] text-surface-400 px-3 py-4 text-center">No fields match "{search}"</p>
          )
        ) : (
          <>
            {schema.queryType && (
              <RootTypeSection label="Query" typeName={schema.queryType} typeMap={schema.typeMap} listOnly={listOnly} onInsert={onInsert} />
            )}
            {schema.mutationType && (
              <RootTypeSection label="Mutation" typeName={schema.mutationType} typeMap={schema.typeMap} listOnly={listOnly} onInsert={onInsert} />
            )}
            {schema.subscriptionType && (
              <RootTypeSection label="Subscription" typeName={schema.subscriptionType} typeMap={schema.typeMap} listOnly={listOnly} onInsert={onInsert} />
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
  const activeCollectionId  = useStore(s => s.activeCollectionId);
  // Resolved through the extends inheritance chain so inherited variables
  // participate in introspection just like at send time.
  const envData        = useActiveEnvironment();
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

  // Insert a field from the explorer by editing the query AST and printing it,
  // so the result is always valid: the field lands in the right operation, its
  // required args become typed variables (added to the signature + seeded into
  // the variables JSON), and object/union fields get a valid selection set.
  const handleInsert = useCallback<InsertHandler>((field, path, opType, allFields) => {
    if (!schema) return;
    const { query, variables } = insertField(gql.query, gql.variables, schema, opType, path, field, gql.operationName || undefined, { allFields });
    onChange({ body: { ...request.body, graphql: { ...gql, query, variables } } });
  }, [gql, onChange, request.body, schema]);

  // Live validation against the schema, plus a used-but-unset variable check.
  const problems = useMemo(() => validateQuery(gqlSchema, gql.query, gql.variables), [gqlSchema, gql.query, gql.variables]);
  const errors = problems.filter(p => p.severity === 'error');
  const warnings = problems.filter(p => p.severity === 'warning');

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
          <div className="w-56 flex-shrink-0 min-h-0 border border-surface-700 rounded overflow-hidden flex flex-col">
            <div className="px-2 py-1 border-b border-surface-800 flex-shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-600">Schema</span>
            </div>
            <SchemaExplorer schema={schema!} onInsert={handleInsert} />
          </div>
        )}

        {/* Right: query + variables */}
        <div className="flex-1 flex flex-col min-h-0 gap-2">
          {/* Query editor */}
          <div className="flex-1 min-h-0 rounded overflow-hidden border border-surface-700 flex flex-col">
            <div className="flex items-center justify-between px-2 py-0.5 bg-surface-800/50 border-b border-surface-700 shrink-0">
              {!gql.query.trim() ? <span /> : errors.length ? (
                <span className="text-[10px] text-red-400" title={errors.map(e => e.message).join('\n')}>✗ {errors.length} error{errors.length !== 1 ? 's' : ''}</span>
              ) : warnings.length ? (
                <span className="text-[10px] text-amber-400" title={warnings.map(w => w.message).join('\n')}>▲ {warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
              ) : (
                <span className="text-[10px] text-emerald-400">✓ valid</span>
              )}
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
            <div className="flex-1 min-h-0">
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
