// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { IntrospectionQuery } from 'graphql';

// ─── Introspection types ──────────────────────────────────────────────────────

export interface GqlTypeRef {
  kind: string
  name: string | null
  ofType: GqlTypeRef | null
}

export interface GqlArg {
  name: string
  type: GqlTypeRef
  description?: string | null
}

export interface GqlField {
  name: string
  type: GqlTypeRef
  args: GqlArg[]
  description?: string | null
}

export interface GqlType {
  name: string
  kind: string
  description?: string | null
  fields: GqlField[] | null
}

export interface ParsedSchema {
  queryType: string | null
  mutationType: string | null
  subscriptionType: string | null
  typeMap: Map<string, GqlType>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function displayType(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL') return displayType(ref.ofType) + '!';
  if (ref.kind === 'LIST') return '[' + displayType(ref.ofType) + ']';
  return ref.name ?? '';
}

export function getBaseTypeName(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL' || ref.kind === 'LIST') return getBaseTypeName(ref.ofType);
  return ref.name ?? '';
}

export function getBaseKind(ref: GqlTypeRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'NON_NULL' || ref.kind === 'LIST') return getBaseKind(ref.ofType);
  return ref.kind;
}

export function isLeafKind(kind: string): boolean {
  return kind === 'SCALAR' || kind === 'ENUM';
}

export function isRequired(ref: GqlTypeRef | null): boolean {
  return !!ref && ref.kind === 'NON_NULL';
}

/** Default literal value for an argument based on its type. Picks something
 *  the user can immediately edit in place, instead of a `$var` reference
 *  that forces a side-trip to the variables JSON. Common pagination names
 *  get pragmatic integers (`first: 5`, `skip: 0`). */
export function defaultArgValue(arg: GqlArg): string {
  const baseTypeName = getBaseTypeName(arg.type);
  const baseKind     = getBaseKind(arg.type);
  const isList       = arg.type.kind === 'LIST'
    || (arg.type.kind === 'NON_NULL' && arg.type.ofType?.kind === 'LIST');

  // Pagination heuristic — well-known arg names get useful defaults so the
  // user lands on a runnable query for the most common case.
  const name = arg.name.toLowerCase();
  if (baseTypeName === 'Int' || baseTypeName === 'Long') {
    if (['first', 'last', 'limit', 'take', 'top', 'count', 'size'].includes(name)) return '5';
    if (['skip', 'offset', 'page'].includes(name)) return '0';
    return '10';
  }

  if (isList) return '[]';

  switch (baseTypeName) {
    case 'Float':
    case 'Double':   return '1.0';
    case 'Boolean':  return 'true';
    case 'ID':       return '"id"';
    case 'String':   return '""';
    case 'DateTime':
    case 'Date':     return '""';
  }

  // Enum — we don't have the enum's values cached here, so leave a hint the
  // user can replace. Same for input objects (complex shapes need a JSON
  // variable anyway).
  if (baseKind === 'ENUM') return `# ${baseTypeName}`;
  return `$${arg.name}`;
}

/** Build a smart field snippet:
 *  - scalars  → `name`
 *  - objects  → `name { <first scalars> }`
 *  - args     → required args + well-known pagination args, with literal
 *               defaults inlined so the snippet is runnable without first
 *               populating the variables JSON. */
export function buildSnippet(field: GqlField, typeMap: Map<string, GqlType>): string {
  const baseTypeName = getBaseTypeName(field.type);
  const baseKind     = getBaseKind(field.type);
  const type         = typeMap.get(baseTypeName);

  // Include required args (NON_NULL) and recognizable pagination args. Other
  // optional args are dropped — the user can add them back via the schema
  // explorer or autocomplete if they need them.
  const PAGINATION_NAMES = new Set([
    'first', 'last', 'limit', 'take', 'top', 'count', 'size',
    'skip', 'offset', 'page',
    'after', 'before',
  ]);
  const includedArgs = field.args.filter(a =>
    isRequired(a.type) || PAGINATION_NAMES.has(a.name.toLowerCase()),
  );
  const args = includedArgs.length > 0
    ? `(${includedArgs.map(a => `${a.name}: ${defaultArgValue(a)}`).join(', ')})`
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
export function insertSnippet(query: string, snippet: string, parentField?: string): string {
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

export const INTROSPECTION_QUERY = `query IntrospectionQuery {
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

export interface FetchSchemaResult {
  parsed: ParsedSchema
  /** Raw introspection JSON for caching + building the full GraphQLSchema. */
  rawIntrospection: IntrospectionQuery
}

export function parseIntrospection(rawData: { __schema: unknown }): ParsedSchema {
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

export async function fetchSchemaFromUrl(url: string, extraHeaders: Record<string, string> = {}): Promise<FetchSchemaResult> {
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
