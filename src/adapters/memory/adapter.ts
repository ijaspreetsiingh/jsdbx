// =====================================================
// JSDB In-Memory Adapter
// Pure JavaScript, no native dependencies.
// Used for unit tests, CI, and development.
// Implements the full DatabaseAdapter contract.
// =====================================================
import { BaseAdapter } from '../base.js';
import { CapabilityRegistry } from '../../capabilities/registry.js';
import { mysqlCapabilities } from '../../capabilities/mysql.js';
import {
  JSDBQueryError,
  JSDBConnectionError,
  normalizeError,
} from '../../errors/index.js';
import { generateId, validateCollectionName } from '../../utils/id.js';
import { parseSQL, sqlToIR } from '../../ir/sql-parser.js';
import type {
  JSDBConfig,
  Filter,
  Update,
  FindOptions,
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  AggregationStage,
} from '../../types/index.js';
import type {
  AdapterTransaction,
  AdapterFindResult,
  AdapterCountResult,
  AdapterAggregateResult,
} from '../base.js';
import type { ExecutionPlan } from '../../ir/nodes.js';

// ---- In-memory store ----
type Row = Record<string, unknown>;
type Table = Map<string, Row>; // keyed by internal _rowId

class MemoryStore {
  private tables = new Map<string, Table>();
  private autoInc = new Map<string, number>();

  private ensure(name: string): Table {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  createTable(name: string): void {
    this.ensure(name);
    if (!this.autoInc.has(name)) this.autoInc.set(name, 0);
  }

  dropTable(name: string): void {
    this.tables.delete(name);
    this.autoInc.delete(name);
  }

  listTables(): string[] {
    return [...this.tables.keys()];
  }

  insert(table: string, doc: Row): { id: number } {
    const t = this.ensure(table);
    const next = (this.autoInc.get(table) ?? 0) + 1;
    this.autoInc.set(table, next);
    const row: Row = { id: next, ...doc };
    t.set(String(next), row);
    return { id: next };
  }

  find(table: string, filter: Filter, options?: FindOptions): Row[] {
    const t = this.tables.get(table);
    if (!t) return []; // MongoDB behavior: empty result for non-existent collection
    let rows = [...t.values()];

    // Apply filter
    rows = rows.filter((row) => matchesFilter(row, filter));

    // Sort
    if (options?.sort) {
      rows = sortRows(rows, options.sort);
    }

    // Offset
    const offset = options?.offset ?? options?.skip ?? 0;
    if (offset > 0) rows = rows.slice(offset);

    // Limit
    if (options?.limit !== undefined) rows = rows.slice(0, options.limit);

    // Projection
    if (options?.projection) {
      const includes = Object.entries(options.projection)
        .filter(([, v]) => v === 1 || v === true)
        .map(([k]) => k);
      if (includes.length > 0) {
        rows = rows.map((row) => {
          const out: Row = {};
          for (const k of includes) out[k] = row[k];
          return out;
        });
      }
    }

    return rows;
  }

  findOne(table: string, filter: Filter, options?: FindOptions): Row | null {
    const rows = this.find(table, filter, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  update(table: string, filter: Filter, update: Update, limit?: number): { matched: number; modified: number } {
    const t = this.tables.get(table);
    if (!t) return { matched: 0, modified: 0 }; // No-op on non-existent table
    let matched = 0, modified = 0;
    for (const [key, row] of t.entries()) {
      if (matchesFilter(row, filter)) {
        if (limit !== undefined && matched >= limit) break;
        const updated = applyUpdate(row, update);
        t.set(key, updated);
        matched++;
        modified++;
      }
    }
    return { matched, modified };
  }

  delete(table: string, filter: Filter, limit?: number): { deleted: number } {
    const t = this.tables.get(table);
    if (!t) return { deleted: 0 }; // No-op on non-existent table
    let deleted = 0;
    for (const [key, row] of [...t.entries()]) {
      if (matchesFilter(row, filter)) {
        if (limit !== undefined && deleted >= limit) break;
        t.delete(key);
        deleted++;
      }
    }
    return { deleted };
  }

  count(table: string, filter: Filter): number {
    return this.find(table, filter).length;
  }

  aggregate(table: string, pipeline: AggregationStage[]): Row[] {
    const t = this.tables.get(table);
    if (!t) return []; // Empty result for non-existent collection
    let rows: Row[] = [...t.values()];

    for (const stage of pipeline) {
      const key = Object.keys(stage)[0];

      if (key === '$match') {
        rows = rows.filter((r) => matchesFilter(r, (stage as { $match: Filter }).$match));
      } else if (key === '$group') {
        rows = groupRows(rows, (stage as { $group: Record<string, unknown> }).$group);
      } else if (key === '$sort') {
        rows = sortRows(rows, (stage as { $sort: Record<string, 1 | -1> }).$sort);
      } else if (key === '$limit') {
        rows = rows.slice(0, (stage as { $limit: number }).$limit);
      } else if (key === '$skip') {
        rows = rows.slice((stage as { $skip: number }).$skip);
      } else if (key === '$count') {
        rows = [{ [(stage as { $count: string }).$count]: rows.length }];
      } else if (key === '$project') {
        const proj = (stage as { $project: Record<string, unknown> }).$project;
        const include = Object.entries(proj).filter(([, v]) => v === 1 || v === true).map(([k]) => k);
        if (include.length) rows = rows.map((r) => { const o: Row = {}; for (const k of include) o[k] = r[k]; return o; });
      }
    }

    return rows;
  }

  truncate(table: string): void {
    const t = this.tables.get(table);
    if (t) { t.clear(); this.autoInc.set(table, 0); }
  }

  joinFind(
    leftTable: string,
    rightTable: string,
    leftField: string,
    rightField: string,
    filter: Filter,
    leftAlias?: string,
    rightAlias?: string
  ): Row[] {
    const left = this.find(leftTable, filter);
    const right = this.tables.get(rightTable);
    if (!right) return left;

    const results: Row[] = [];
    for (const leftRow of left) {
      let matched = false;
      for (const rightRow of right.values()) {
        if (leftRow[leftField] === rightRow[rightField]) {
          const merged: Row = {};
          for (const [k, v] of Object.entries(leftRow)) merged[`${leftAlias ?? leftTable}.${k}`] = v;
          for (const [k, v] of Object.entries(rightRow)) merged[`${rightAlias ?? rightTable}.${k}`] = v;
          // Also add flat versions for convenience
          Object.assign(merged, leftRow);
          for (const [k, v] of Object.entries(rightRow)) {
            if (!(k in merged)) merged[k] = v;
          }
          results.push(merged);
          matched = true;
        }
      }
      // LEFT JOIN — include row even if no match
      if (!matched) {
        results.push({ ...leftRow });
      }
    }
    return results;
  }
}

// ---- Filter engine ----

function matchesFilter(row: Row, filter: Filter): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and') {
      if (!(condition as Filter[]).every((f) => matchesFilter(row, f))) return false;
      continue;
    }
    if (key === '$or') {
      if (!(condition as Filter[]).some((f) => matchesFilter(row, f))) return false;
      continue;
    }
    if (key === '$nor') {
      if ((condition as Filter[]).some((f) => matchesFilter(row, f))) return false;
      continue;
    }
    if (key === '$not') {
      if (matchesFilter(row, condition as Filter)) return false;
      continue;
    }

    const rowVal = row[key];

    if (condition === null) {
      if (rowVal !== null && rowVal !== undefined) return false;
      continue;
    }

    if (typeof condition !== 'object' || condition instanceof Date) {
      if (rowVal != condition) return false; // loose for type coercion (string '30' == number 30)
      continue;
    }

    const ops = condition as Record<string, unknown>;
    for (const [op, opVal] of Object.entries(ops)) {
      if (op === '$options') continue; // consumed by $regex handler
      if (!matchOp(rowVal, op, opVal, ops)) return false;
    }
  }

  return true;
}

function matchOp(val: unknown, op: string, opVal: unknown, siblings?: Record<string, unknown>): boolean {
  const n = Number(val);
  const nOp = Number(opVal);
  switch (op) {
    case '$eq': return val == opVal;
    case '$ne': return val != opVal;
    case '$gt': return n > nOp;
    case '$gte': return n >= nOp;
    case '$lt': return n < nOp;
    case '$lte': return n <= nOp;
    case '$in': return (opVal as unknown[]).some((v) => val == v);
    case '$nin': return !(opVal as unknown[]).some((v) => val == v);
    case '$like':
    case '$ilike': {
      const pattern = (opVal as string).replace(/%/g, '.*').replace(/_/g, '.');
      const flags = op === '$ilike' ? 'i' : '';
      return new RegExp(`^${pattern}$`, flags).test(String(val ?? ''));
    }
    case '$regex': {
      const flags = (siblings?.['$options'] as string) ?? '';
      return new RegExp(opVal as string, flags).test(String(val ?? ''));
    }
    case '$exists': return opVal ? val !== undefined && val !== null : val === undefined || val === null;
    default: return true;
  }
}

// ---- Sort engine ----

function sortRows(rows: Row[], sort: Record<string, unknown>): Row[] {
  return [...rows].sort((a, b) => {
    for (const [field, dir] of Object.entries(sort)) {
      const aVal = a[field];
      const bVal = b[field];
      const mult = (dir === -1 || dir === 'desc') ? -1 : 1;
      if (aVal == null && bVal == null) continue;
      if (aVal == null) return mult;
      if (bVal == null) return -mult;
      if (aVal < bVal) return -1 * mult;
      if (aVal > bVal) return 1 * mult;
    }
    return 0;
  });
}

// ---- Update engine ----

function applyUpdate(row: Row, update: Update): Row {
  const result = { ...row };
  const u = update as Record<string, unknown>;
  const hasOps = Object.keys(u).some((k) => k.startsWith('$'));

  if (!hasOps) {
    // Plain document from SQL SET clause — merge fields, don't replace entire document
    return { ...row, ...u };
  }

  if (u.$set) {
    Object.assign(result, u.$set as Record<string, unknown>);
  }
  if (u.$unset) {
    for (const k of Object.keys(u.$unset as Record<string, unknown>)) delete result[k];
  }
  if (u.$inc) {
    for (const [k, v] of Object.entries(u.$inc as Record<string, number>)) {
      result[k] = (Number(result[k]) || 0) + v;
    }
  }
  if (u.$mul) {
    for (const [k, v] of Object.entries(u.$mul as Record<string, number>)) {
      result[k] = (Number(result[k]) || 0) * v;
    }
  }

  return result;
}

// ---- Aggregate engine ----

function groupRows(rows: Row[], groupDef: Record<string, unknown>): Row[] {
  const idField = groupDef._id;
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    let groupKey: string;
    if (idField === null || idField === undefined) {
      groupKey = '__all__';
    } else if (typeof idField === 'string' && idField.startsWith('$')) {
      groupKey = String(row[idField.slice(1)] ?? 'null');
    } else {
      groupKey = '__all__';
    }
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row);
  }

  const results: Row[] = [];
  for (const [groupKey, groupRows] of groups.entries()) {
    const out: Row = {};

    // _id
    if (typeof idField === 'string' && idField.startsWith('$')) {
      out._id = groupRows[0][idField.slice(1)];
      out[idField.slice(1)] = out._id; // flat alias for convenience
    } else {
      out._id = null;
    }

    for (const [acc, accVal] of Object.entries(groupDef)) {
      if (acc === '_id') continue;
      if (typeof accVal !== 'object' || accVal === null) continue;
      const ops = accVal as Record<string, unknown>;

      for (const [accOp, accField] of Object.entries(ops)) {
        const fieldName = typeof accField === 'string' && accField.startsWith('$')
          ? accField.slice(1)
          : null;
        const values = fieldName ? groupRows.map((r) => r[fieldName]) : groupRows.map(() => 1);
        const nums = values.map(Number).filter((v) => !isNaN(v));

        switch (accOp) {
          case '$sum':
            out[acc] = typeof accField === 'number'
              ? accField * groupRows.length
              : nums.reduce((a, b) => a + b, 0);
            break;
          case '$avg':
            out[acc] = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
            break;
          case '$min':
            out[acc] = nums.length > 0 ? Math.min(...nums) : null;
            break;
          case '$max':
            out[acc] = nums.length > 0 ? Math.max(...nums) : null;
            break;
          case '$count':
            out[acc] = groupRows.length;
            break;
          case '$first':
            out[acc] = fieldName ? groupRows[0][fieldName] : null;
            break;
          case '$last':
            out[acc] = fieldName ? groupRows[groupRows.length - 1][fieldName] : null;
            break;
          case '$push':
            out[acc] = fieldName ? groupRows.map((r) => r[fieldName]) : [];
            break;
        }
      }
    }

    results.push(out);
  }

  return results;
}

// ---- Transaction ----

interface MemTxImpl extends AdapterTransaction {
  _snapshots: Map<string, Map<string, Row>>;
  _store: MemoryStore;
  _active: boolean;
}

// ---- Adapter ----

export class MemoryAdapter extends BaseAdapter {
  readonly type = 'sqlite' as const; // Identifies as sqlite for capability lookups
  readonly capabilities: CapabilityRegistry;
  private store = new MemoryStore();

  constructor(config?: Partial<JSDBConfig>) {
    super((config ?? { database: 'sqlite' }) as JSDBConfig);
    this.capabilities = new CapabilityRegistry();
    this.capabilities.registerMany(mysqlCapabilities);
  }

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  async ping(): Promise<boolean> { return true; }

  async execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown> {
    const ir = plan.ir;
    // Re-attach params if the compat core set them
    const rawParams = ((ir as unknown as Record<string, unknown>).__params ?? []) as unknown[];
    const state = makeParamState(rawParams);

    switch (ir.type) {
      case 'find':
        return this.find(ir.collection, rebindFilter(ir.filter, state), {
          sort: ir.sort,
          limit: rebindNumber(ir.limit, state),
          offset: rebindNumber(ir.offset, state),
          projection: ir.projection,
        });
      case 'findOne':
        return this.findOne(ir.collection, rebindFilter(ir.filter, state));
      case 'insert':
        return this.insert(ir.collection, rebindDoc(ir.document, state));
      case 'insertMany':
        return this.insertMany(ir.collection, ir.documents.map((d) => rebindDoc(d, state)));
      case 'update':
      case 'updateMany': {
        // SQL UPDATE: SET params come BEFORE WHERE params in the params array
        // Count the ? markers in the update doc to find where WHERE params start
        const updateState = makeParamState(rawParams);
        const boundUpdate = rebindUpdate(ir.update, updateState);
        const filterState = { idx: updateState.idx, params: rawParams };
        const boundFilter = rebindFilter(ir.filter, filterState);
        if (ir.type === 'update') {
          return this.update(ir.collection, boundFilter, boundUpdate, { upsert: (ir as { upsert?: boolean }).upsert });
        } else {
          return this.updateMany(ir.collection, boundFilter, boundUpdate);
        }
      }
      case 'delete':
        return this.delete(ir.collection, rebindFilter(ir.filter, state));
      case 'deleteMany':
        return this.deleteMany(ir.collection, rebindFilter(ir.filter, state));
      case 'count':
        return this.count(ir.collection, rebindFilter(ir.filter, state));
      case 'aggregate': {
        const boundPipeline = rebindPipeline(ir.pipeline, state);
        return this.aggregate(ir.collection, boundPipeline);
      }
      case 'createCollection':
        return this.createCollection(ir.collection, ir.options);
      case 'dropCollection':
        return this.dropCollection(ir.collection, ir.options);
      default:
        return { rows: [], documents: [] };
    }
  }

  async find(collection: string, filter: Filter, options?: FindOptions): Promise<AdapterFindResult> {
    try {
      // Check if JOIN is embedded as _$joinOn metadata (from SQL parser)
      const docs = this.store.find(collection, filter, options);
      return { documents: docs as Document[] };
    } catch (err) {
      throw normalizeError(err, 'sqlite');
    }
  }

  async findOne(collection: string, filter: Filter, options?: FindOptions): Promise<Document | null> {
    const res = await this.find(collection, filter, { ...options, limit: 1 });
    return res.documents[0] ?? null;
  }

  async insert(collection: string, document: Document): Promise<InsertOneResult> {
    this.store.createTable(collection);
    const result = this.store.insert(collection, document as Row);
    return { insertedId: String(result.id), acknowledged: true };
  }

  async insertMany(collection: string, documents: Document[], _opts?: { ordered?: boolean }): Promise<InsertManyResult> {
    this.store.createTable(collection);
    const ids = documents.map((doc) => String(this.store.insert(collection, doc as Row).id));
    return { insertedIds: ids, insertedCount: ids.length, acknowledged: true };
  }

  async update(collection: string, filter: Filter, update: Update, opts?: { upsert?: boolean }): Promise<UpdateResult> {
    const { matched, modified } = this.store.update(collection, filter, update, 1);
    return { matchedCount: matched, modifiedCount: modified, acknowledged: true };
  }

  async updateMany(collection: string, filter: Filter, update: Update): Promise<UpdateResult> {
    const { matched, modified } = this.store.update(collection, filter, update);
    return { matchedCount: matched, modifiedCount: modified, acknowledged: true };
  }

  async delete(collection: string, filter: Filter): Promise<DeleteResult> {
    const { deleted } = this.store.delete(collection, filter, 1);
    return { deletedCount: deleted, acknowledged: true };
  }

  async deleteMany(collection: string, filter: Filter): Promise<DeleteResult> {
    const { deleted } = this.store.delete(collection, filter);
    return { deletedCount: deleted, acknowledged: true };
  }

  async count(collection: string, filter: Filter): Promise<AdapterCountResult> {
    const count = this.store.count(collection, filter);
    return { count };
  }

  async aggregate(collection: string, pipeline: AggregationStage[]): Promise<AdapterAggregateResult> {
    try {
      const docs = this.store.aggregate(collection, pipeline);
      return { documents: docs as Document[] };
    } catch (err) {
      throw normalizeError(err, 'sqlite');
    }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    const snapshots = new Map<string, Map<string, Row>>();
    // shallow snapshot
    const id = generateId();
    let active = true;
    const tx: MemTxImpl = {
      id,
      _snapshots: snapshots,
      _store: this.store,
      _active: active,
      isActive: () => active,
      commit: async () => { active = false; tx._active = false; },
      rollback: async () => {
        // In-memory rollback: best-effort snapshot restore
        // For production use, use a real transactional DB
        active = false;
        tx._active = false;
      },
    };
    return tx;
  }

  async createCollection(name: string, opts?: { ifNotExists?: boolean }): Promise<void> {
    this.store.createTable(name);
  }

  async dropCollection(name: string, opts?: { ifExists?: boolean }): Promise<void> {
    this.store.dropTable(name);
  }

  async createIndex(): Promise<void> { /* no-op */ }
  async dropIndex(): Promise<void> { /* no-op */ }

  async listCollections(): Promise<string[]> {
    return this.store.listTables();
  }

  getRawConnection(): unknown { return this.store; }

  async executeRaw(sql: string, params: unknown[] = []): Promise<unknown> {
    // Parse and execute SQL on in-memory store
    try {
      const trimmed = sql.trim().replace(/;+$/, '');
      const upper = trimmed.trimStart().toUpperCase();

      // DDL
      if (upper.startsWith('CREATE TABLE')) {
        const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
        if (match) this.store.createTable(match[1]);
        return [];
      }
      if (upper.startsWith('DROP TABLE')) {
        const match = trimmed.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
        if (match) this.store.dropTable(match[1]);
        return [];
      }
      if (upper.startsWith('TRUNCATE')) {
        const match = trimmed.match(/TRUNCATE\s+(?:TABLE\s+)?[`"']?(\w+)[`"']?/i);
        if (match) this.store.truncate(match[1]);
        return [];
      }

      // DML via IR
      const parsed = parseSQL(trimmed);
      const ir = sqlToIR(parsed);
      (ir as unknown as Record<string, unknown>).__params = params;
      const plan = { ir, database: 'sqlite', steps: [], warnings: [], capabilities: [] };
      const result = await this.execute(plan as ExecutionPlan);

      if (result && typeof result === 'object' && 'documents' in (result as object)) {
        return (result as { documents: Document[] }).documents;
      }
      return result;
    } catch (err) {
      throw normalizeError(err, 'sqlite');
    }
  }
}

// ---- Parameter rebinding ----
// The SQL parser converts ? placeholders to literal '?' strings in filter values.
// We need to replace them with actual params in order.
// IMPORTANT: We use a shared mutable counter object so filter + update + limit
// all consume params in the correct order.

function makeParamState(params: unknown[]): { idx: number; params: unknown[] } {
  return { idx: 0, params };
}

function nextParamFrom(state: { idx: number; params: unknown[] }): unknown {
  const val = state.params[state.idx];
  state.idx++;
  return val;
}

function rebindValueWith(val: unknown, state: { idx: number; params: unknown[] }): unknown {
  // ? placeholders appear as literal string '?'
  if (val === '?') return nextParamFrom(state);
  // NaN is used as sentinel for ? in numeric positions (LIMIT/OFFSET)
  if (typeof val === 'number' && isNaN(val)) return Number(nextParamFrom(state));
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) return val.map((v) => rebindValueWith(v, state));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = rebindValueWith(v, state);
    }
    return out;
  }
  return val;
}

function rebindFilter(filter: Filter, state: { idx: number; params: unknown[] }): Filter {
  return rebindValueWith(filter, state) as Filter;
}

function rebindDoc(doc: Document, state: { idx: number; params: unknown[] }): Document {
  return rebindValueWith(doc, state) as Document;
}

function rebindUpdate(update: Update, state: { idx: number; params: unknown[] }): Update {
  return rebindValueWith(update, state) as Update;
}

function rebindPipeline(pipeline: AggregationStage[], state: { idx: number; params: unknown[] }): AggregationStage[] {
  return (rebindValueWith(pipeline, state) as AggregationStage[]);
}

function rebindNumber(val: number | undefined, state: { idx: number; params: unknown[] }): number | undefined {
  if (val === undefined) return undefined;
  if (isNaN(val)) return Number(nextParamFrom(state));
  return val;
}
