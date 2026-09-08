// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// AST-based GraphQL query building. Inserting a field from the schema explorer
// works on the parsed document (not string splicing), so the result is ALWAYS
// syntactically valid: fields land in the right operation/selection set,
// required arguments become typed variables (added to the operation signature
// and seeded into the variables JSON), and object/interface/union fields get a
// non-empty, valid selection set. Printing the AST guarantees valid syntax.

import { parse, print, validate, Kind, type GraphQLSchema } from 'graphql';
import type {
  DocumentNode, OperationDefinitionNode, FieldNode, SelectionSetNode,
  VariableDefinitionNode, ArgumentNode, TypeNode, SelectionNode,
} from 'graphql';
import {
  type GqlField, type GqlType, type GqlTypeRef, type ParsedSchema,
  getBaseTypeName, getBaseKind, isLeafKind, argRequired,
} from './graphql-introspection';

export type OperationType = 'query' | 'mutation' | 'subscription';

const LEAF_LIMIT = 6;
const name = (value: string) => ({ kind: Kind.NAME as const, value });

// ─── GqlTypeRef -> AST TypeNode + JSON seed ───────────────────────────────────

function toTypeNode(ref: GqlTypeRef): TypeNode {
  if (ref.kind === 'NON_NULL') return { kind: Kind.NON_NULL_TYPE, type: toTypeNode(ref.ofType!) as TypeNode & { kind: Kind.NAMED_TYPE | Kind.LIST_TYPE } };
  if (ref.kind === 'LIST') return { kind: Kind.LIST_TYPE, type: toTypeNode(ref.ofType!) };
  return { kind: Kind.NAMED_TYPE, name: name(ref.name ?? 'String') };
}

function isListRef(ref: GqlTypeRef): boolean {
  return ref.kind === 'LIST' || (ref.kind === 'NON_NULL' && ref.ofType?.kind === 'LIST');
}

/** A placeholder value for a freshly-added variable, typed roughly right so the
 *  variables JSON is usable immediately (the user fills in real values). */
function seedFor(ref: GqlTypeRef): unknown {
  if (isListRef(ref)) return [];
  switch (getBaseTypeName(ref)) {
    case 'Int': case 'Long': case 'Float': case 'Double': return 0;
    case 'Boolean': return false;
    default: return '';
  }
}

// ─── Argument / variable construction ─────────────────────────────────────────

interface VarRegistry {
  defs: Map<string, VariableDefinitionNode>   // var name -> definition
  seeds: Record<string, unknown>
}

// A unique variable name for (arg, field): prefer the bare arg name, but if it
// is already taken by a different type, qualify it with the field name.
function variableFor(field: GqlField, arg: GqlField['args'][number], reg: VarRegistry): string {
  const typeStr = print(toTypeNode(arg.type));
  const existing = reg.defs.get(arg.name);
  if (!existing) return arg.name;
  if (print(existing.type) === typeStr) return arg.name;   // same type -> share
  return `${field.name}_${arg.name}`;
}

// Well-known pagination arg names: when required (e.g. Lighthouse's
// `first: Int!`), we inline a sensible number so the query runs immediately
// instead of forcing the user to fill a variable.
const PAGE_SIZE = new Set(['first', 'last', 'limit', 'take', 'top', 'count', 'size', 'perpage', 'per_page']);
const PAGE_ZERO = new Set(['skip', 'offset']);

// Only REQUIRED (non-null) arguments are added. Optional args (including
// optional pagination) are left out so a plain field inserts clean. A required
// pagination Int gets an inline literal; every other required arg becomes a
// typed variable (added to the signature + seeded into the variables JSON).
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

// ─── Selection sets ───────────────────────────────────────────────────────────

/** A valid, non-empty selection set for a composite type: its leaf (scalar/enum)
 *  fields, always at least __typename so unions (and fieldless types) stay valid.
 *  `all` selects every leaf field; otherwise the first LEAF_LIMIT. */
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

/** Build a FieldNode for a field. `withSelection` adds a leaf selection set when
 *  the field's type is composite (only the deepest inserted field needs one;
 *  intermediate ancestors get their selection set from navigation). `all` picks
 *  every leaf field instead of the first few. */
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

// ─── Document navigation ──────────────────────────────────────────────────────

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

// Resolve the chain of GqlFields for a path of field names, starting from the
// root type. Lets intermediate ancestors be created with their required args.
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

/** Add `sel` to a selection set if a field with the same name is not already
 *  present (mutating a copy). Returns the field node that now lives there. */
function upsertField(set: { selections: SelectionNode[] }, fieldNode: FieldNode): FieldNode {
  const existing = set.selections.find((s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === fieldNode.name.value);
  if (existing) return existing;
  set.selections.push(fieldNode);
  return fieldNode;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InsertResult { query: string; variables: string }

/** Insert `field` (found under `path` in the root `operationType` type) into the
 *  query, returning a printed, valid query and the merged variables JSON. */
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

  // Parse the current query; on any problem start from a clean document so we
  // never build on top of invalid syntax.
  let doc: DocumentNode;
  try { doc = currentQuery.trim() ? parse(currentQuery) : { kind: Kind.DOCUMENT, definitions: [] }; }
  catch { doc = { kind: Kind.DOCUMENT, definitions: [] }; }

  const created = findOrCreateOperation(doc, operationType, operationName);
  doc = created.doc;

  // Work on a deep-cloned operation so we can mutate selection sets freely.
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

  // `doc` already contains created.op (findOrCreateOperation appends it); swap
  // in the mutated clone.
  const definitions = doc.definitions.map(d => (d === created.op ? op : d));
  return {
    query: print({ kind: Kind.DOCUMENT, definitions }),
    variables: mergeVariables(currentVariables, reg.seeds),
  };
}

/** Merge new variable seeds into the variables JSON without clobbering values
 *  the user already set. */
export function mergeVariables(currentJson: string, seeds: Record<string, unknown>): string {
  if (Object.keys(seeds).length === 0) return currentJson;
  let obj: Record<string, unknown> = {};
  try { obj = currentJson.trim() ? JSON.parse(currentJson) : {}; } catch { obj = {}; }
  const merged = { ...seeds, ...obj };   // existing values win
  return JSON.stringify(merged, null, 2);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface QueryProblem { message: string; severity: 'error' | 'warning' }

/** Validate the query against the schema, plus a check that every used variable
 *  is present in the variables JSON. Empty array means all good. */
export function validateQuery(schema: GraphQLSchema | null, query: string, variablesJson: string): QueryProblem[] {
  if (!query.trim()) return [];
  let doc: DocumentNode;
  try { doc = parse(query); }
  catch (e) { return [{ message: e instanceof Error ? e.message : String(e), severity: 'error' }]; }

  const problems: QueryProblem[] = [];
  if (schema) {
    for (const err of validate(schema, doc)) problems.push({ message: err.message, severity: 'error' });
  }

  // Variables referenced but not provided (warning, since some may be intended
  // to come from {{env}} substitution at send-time).
  let provided: Record<string, unknown> = {};
  try { provided = variablesJson.trim() ? JSON.parse(variablesJson) : {}; } catch { /* invalid JSON handled elsewhere */ }
  const used = new Set<string>();
  for (const m of query.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
  for (const v of used) {
    if (!(v in provided)) problems.push({ message: `Variable "$${v}" is not set in Variables`, severity: 'warning' });
  }
  return problems;
}
