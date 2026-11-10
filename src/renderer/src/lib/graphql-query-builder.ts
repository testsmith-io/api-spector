// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// AST-based GraphQL query building: a field is inserted into the parsed document, not by
// string splicing, so the result stays valid (right selection set, required args become typed variables).

import {
  parse, print, validate, Kind,
  type GraphQLSchema,
  type DocumentNode, type OperationDefinitionNode, type FieldNode, type SelectionSetNode,
  type VariableDefinitionNode, type ArgumentNode, type TypeNode, type SelectionNode,
} from 'graphql';
import {
  type GqlField, type GqlType, type GqlTypeRef, type ParsedSchema,
  getBaseTypeName, getBaseKind, isLeafKind, argRequired,
} from './graphql-introspection';

export type OperationType = 'query' | 'mutation' | 'subscription';

const LEAF_LIMIT = 6;
const name = (value: string) => ({ kind: Kind.NAME as const, value });

// GqlTypeRef -> AST TypeNode + JSON seed

function toTypeNode(ref: GqlTypeRef): TypeNode {
  if (ref.kind === 'NON_NULL') return { kind: Kind.NON_NULL_TYPE, type: toTypeNode(ref.ofType!) as TypeNode & { kind: Kind.NAMED_TYPE | Kind.LIST_TYPE } };
  if (ref.kind === 'LIST') return { kind: Kind.LIST_TYPE, type: toTypeNode(ref.ofType!) };
  return { kind: Kind.NAMED_TYPE, name: name(ref.name ?? 'String') };
}

function isListRef(ref: GqlTypeRef): boolean {
  return ref.kind === 'LIST' || (ref.kind === 'NON_NULL' && ref.ofType?.kind === 'LIST');
}

/** A roughly-typed placeholder for a new variable, for the user to fill in. */
function seedFor(ref: GqlTypeRef): unknown {
  if (isListRef(ref)) return [];
  switch (getBaseTypeName(ref)) {
    case 'Int': case 'Long': case 'Float': case 'Double': return 0;
    case 'Boolean': return false;
    default: return '';
  }
}

// Argument / variable construction

interface VarRegistry {
  defs: Map<string, VariableDefinitionNode>   // var name -> definition
  seeds: Record<string, unknown>
}

// A unique variable name for (arg, field): the bare arg name, qualified with
// the field name if already taken by a different type.
function variableFor(field: GqlField, arg: GqlField['args'][number], reg: VarRegistry): string {
  const typeStr = print(toTypeNode(arg.type));
  const existing = reg.defs.get(arg.name);
  if (!existing) return arg.name;
  if (print(existing.type) === typeStr) return arg.name;   // same type -> share
  return `${field.name}_${arg.name}`;
}

// Pagination arg names: when required, inline a number so the query runs without
// the user filling a variable.
const PAGE_SIZE = new Set(['first', 'last', 'limit', 'take', 'top', 'count', 'size', 'perpage', 'per_page']);
const PAGE_ZERO = new Set(['skip', 'offset']);

// Only required (non-null) args are added. A required pagination Int gets an
// inline literal; every other required arg becomes a typed variable.
function buildArguments(field: GqlField, reg: VarRegistry): ArgumentNode[] {
  const out: ArgumentNode[] = [];
  for (const arg of field.args.filter(argRequired)) {
    const base = getBaseTypeName(arg.type);
    const lname = arg.name.toLowerCase();
    if ((base === 'Int' || base === 'Long') && (PAGE_SIZE.has(lname) || PAGE_ZERO.has(lname))) {
      out.push({ kind: Kind.ARGUMENT, name: name(arg.name), value: { kind: Kind.INT, value: PAGE_ZERO.has(lname) ? '0' : '100' } });
      continue;
    }
    const varName = variableFor(field, arg, reg);
    if (!reg.defs.has(varName)) {
      reg.defs.set(varName, { kind: Kind.VARIABLE_DEFINITION, variable: { kind: Kind.VARIABLE, name: name(varName) }, type: toTypeNode(arg.type) });
      reg.seeds[varName] = seedFor(arg.type);
    }
    out.push({ kind: Kind.ARGUMENT, name: name(arg.name), value: { kind: Kind.VARIABLE, name: name(varName) } });
  }
  return out;
}

// Selection sets

/** A non-empty selection set of a composite type's leaf fields, falling back to
 *  __typename so unions/fieldless types stay valid. `all` picks every leaf,
 *  else the first LEAF_LIMIT. */
function leafSelectionSet(baseTypeName: string, typeMap: Map<string, GqlType>, all: boolean): SelectionSetNode | undefined {
  const type = typeMap.get(baseTypeName);
  const selections: SelectionNode[] = [];
  if (type?.fields?.length) {
    for (const f of type.fields) {
      if (isLeafKind(getBaseKind(f.type)) && f.args.every(a => !argRequired(a))) {
        selections.push({ kind: Kind.FIELD, name: name(f.name) });
        if (!all && selections.length >= LEAF_LIMIT) break;
      }
    }
  }
  if (selections.length === 0) selections.push({ kind: Kind.FIELD, name: name('__typename') });
  return { kind: Kind.SELECTION_SET, selections };
}

/** `withSelection` adds a leaf selection set when the field's type is composite;
 *  only the deepest inserted field needs one. `all` picks every leaf field. */
function buildFieldNode(field: GqlField, typeMap: Map<string, GqlType>, reg: VarRegistry, withSelection: boolean, all = false): FieldNode {
  const args = buildArguments(field, reg);
  const baseKind = getBaseKind(field.type);
  const composite = baseKind === 'OBJECT' || baseKind === 'INTERFACE' || baseKind === 'UNION';
  return {
    kind: Kind.FIELD,
    name: name(field.name),
    ...(args.length ? { arguments: args } : {}),
    ...(withSelection && composite ? { selectionSet: leafSelectionSet(getBaseTypeName(field.type), typeMap, all) } : {}),
  };
}

// Document navigation

function findOrCreateOperation(doc: DocumentNode, opType: OperationType, opName?: string): { doc: DocumentNode; op: OperationDefinitionNode } {
  const ops = doc.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  const existing = ops.find(o => o.operation === opType);
  if (existing) return { doc, op: existing };
  const op: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation: opType as OperationDefinitionNode['operation'],
    ...(opName ? { name: name(opName) } : {}),
    selectionSet: { kind: Kind.SELECTION_SET, selections: [] },
  };
  return { doc: { ...doc, definitions: [...doc.definitions, op] }, op };
}

// The chain of GqlFields for a path of field names from the root type, so
// intermediate ancestors can be created with their required args.
function resolveChain(rootTypeName: string, path: string[], typeMap: Map<string, GqlType>): GqlField[] {
  const chain: GqlField[] = [];
  let currentType = rootTypeName;
  for (const fieldName of path) {
    const f = typeMap.get(currentType)?.fields?.find(x => x.name === fieldName);
    if (!f) break;
    chain.push(f);
    currentType = getBaseTypeName(f.type);
  }
  return chain;
}

/** Add the field unless one of the same name is present; returns the node that
 *  now lives there. */
function upsertField(set: { selections: SelectionNode[] }, fieldNode: FieldNode): FieldNode {
  const existing = set.selections.find((s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === fieldNode.name.value);
  if (existing) return existing;
  set.selections.push(fieldNode);
  return fieldNode;
}

// Public API

export interface InsertResult { query: string; variables: string }

/** Insert `field` (found under `path`) into the query, returning the printed
 *  query and merged variables JSON. */
export function insertField(
  currentQuery: string,
  currentVariables: string,
  schema: ParsedSchema,
  operationType: OperationType,
  path: string[],
  field: GqlField,
  operationName?: string,
  opts: { allFields?: boolean } = {},
): InsertResult {
  const rootTypeName =
    operationType === 'query' ? schema.queryType
    : operationType === 'mutation' ? schema.mutationType
    : schema.subscriptionType;

  // On any parse problem start clean rather than build on invalid syntax.
  let doc: DocumentNode;
  try { doc = currentQuery.trim() ? parse(currentQuery) : { kind: Kind.DOCUMENT, definitions: [] }; }
  catch { doc = { kind: Kind.DOCUMENT, definitions: [] }; }

  const created = findOrCreateOperation(doc, operationType, operationName);
  doc = created.doc;

  // Deep clone so selection sets can be mutated freely.
  const op = JSON.parse(JSON.stringify(created.op)) as OperationDefinitionNode;
  const reg: VarRegistry = { defs: new Map((op.variableDefinitions ?? []).map(v => [v.variable.name.value, v])), seeds: {} };

  // Navigate/create the ancestor chain, then insert the target field.
  const chain = rootTypeName ? resolveChain(rootTypeName, path, schema.typeMap) : [];
  let set = op.selectionSet as unknown as { selections: SelectionNode[] };
  for (let i = 0; i < path.length; i++) {
    const ancestorField = chain[i];
    const node = ancestorField
      ? buildFieldNode(ancestorField, schema.typeMap, reg, false)
      : { kind: Kind.FIELD as const, name: name(path[i]) };
    const here = upsertField(set, node);
    if (!here.selectionSet) (here as { selectionSet?: SelectionSetNode }).selectionSet = { kind: Kind.SELECTION_SET, selections: [] };
    set = here.selectionSet as unknown as { selections: SelectionNode[] };
  }
  upsertField(set, buildFieldNode(field, schema.typeMap, reg, true, opts.allFields));

  (op as { variableDefinitions?: VariableDefinitionNode[] }).variableDefinitions = [...reg.defs.values()];
  if (operationName && !op.name) (op as { name?: ReturnType<typeof name> }).name = name(operationName);

  // Swap the mutated clone in for created.op.
  const definitions = doc.definitions.map(d => (d === created.op ? op : d));
  return {
    query: print({ kind: Kind.DOCUMENT, definitions }),
    variables: mergeVariables(currentVariables, reg.seeds),
  };
}

/** Merge new seeds into the variables JSON without clobbering the user's values. */
export function mergeVariables(currentJson: string, seeds: Record<string, unknown>): string {
  if (Object.keys(seeds).length === 0) return currentJson;
  let obj: Record<string, unknown> = {};
  try { obj = currentJson.trim() ? JSON.parse(currentJson) : {}; } catch { obj = {}; }
  const merged = { ...seeds, ...obj };   // existing values win
  return JSON.stringify(merged, null, 2);
}

// Validation

export interface QueryProblem { message: string; severity: 'error' | 'warning' }

/** Validate the query against the schema, and check every used variable is in
 *  the variables JSON. Empty array means no problems. */
export function validateQuery(schema: GraphQLSchema | null, query: string, variablesJson: string): QueryProblem[] {
  if (!query.trim()) return [];
  let doc: DocumentNode;
  try { doc = parse(query); }
  catch (e) { return [{ message: e instanceof Error ? e.message : String(e), severity: 'error' }]; }

  const problems: QueryProblem[] = [];
  if (schema) {
    for (const err of validate(schema, doc)) problems.push({ message: err.message, severity: 'error' });
  }

  // Referenced but not provided: only a warning, since some come from {{env}}
  // substitution at send-time.
  let provided: Record<string, unknown> = {};
  try { provided = variablesJson.trim() ? JSON.parse(variablesJson) : {}; } catch { /* invalid JSON handled elsewhere */ }
  const used = new Set<string>();
  for (const m of query.matchAll(/\$([A-Za-z_]\w*)/g)) used.add(m[1]);
  for (const v of used) {
    if (!(v in provided)) problems.push({ message: `Variable "$${v}" is not set in Variables`, severity: 'warning' });
  }
  return problems;
}
