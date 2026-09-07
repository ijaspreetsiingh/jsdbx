// =====================================================
// JSDB - Collection API
// Developer-facing API for interacting with a collection
// =====================================================
import type {
  Filter,
  Update,
  Document,
  FindOptions,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  AggregationStage,
  SortSpec,
  ProjectionSpec,
  SortDirection,
} from '../types/index.js';
import type { DatabaseAdapter } from '../adapters/base.js';
import type { AdapterTransaction } from '../adapters/base.js';
import type { CacheManager } from '../cache/cache.js';
import type { ObservabilityManager } from '../observability/index.js';
import type { SecurityManager, SecurityContext } from '../security/index.js';
import type { TenancyConfig, JSDBConfig } from '../types/index.js';
import { generateId } from '../utils/id.js';
import { IRBuilder } from '../ir/builder.js';
import { queryPlanner } from '../planner/planner.js';
import { globalPlanCache } from '../planner/cache.js';

export interface CollectionOptions {
  tx?: AdapterTransaction;
  securityContext?: SecurityContext;
  skipCache?: boolean;
  requestId?: string;
}

/**
 * Fluent collection query builder that executes lazily
 */
export class CollectionQueryChain {
  private _filter: Filter = {};
  private _sort?: SortSpec;
  private _projection?: ProjectionSpec;
  private _limit?: number;
  private _offset = 0;
  private _pipeline?: AggregationStage[];

  constructor(
    private collection: JSDBCollection,
    private options: CollectionOptions = {}
  ) {}

  where(filter: Filter): this;
  where(field: string, operator: string, value: unknown): this;
  where(fieldOrFilter: string | Filter, operator?: string, value?: unknown): this {
    if (typeof fieldOrFilter === 'string') {
      const opMap: Record<string, string> = {
        '=': '$eq', '!=': '$ne', '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte',
        'in': '$in', 'not in': '$nin', 'like': '$like', 'ilike': '$ilike',
      };
      const mongoOp = opMap[operator?.toLowerCase() ?? '='] ?? '$eq';
      this._filter[fieldOrFilter] = { [mongoOp]: value } as Filter;
    } else {
      Object.assign(this._filter, fieldOrFilter);
    }
    return this;
  }

  sort(spec: SortSpec): this;
  sort(field: string, dir?: SortDirection): this;
  sort(specOrField: SortSpec | string, dir?: SortDirection): this {
    if (typeof specOrField === 'string') {
      this._sort = { ...(this._sort ?? {}), [specOrField]: dir ?? 'asc' };
    } else {
      this._sort = { ...(this._sort ?? {}), ...specOrField };
    }
    return this;
  }

  orderBy(field: string, dir: SortDirection = 'asc'): this {
    return this.sort(field, dir);
  }

  limit(n: number): this { this._limit = n; return this; }
  skip(n: number): this { this._offset = n; return this; }
  offset(n: number): this { this._offset = n; return this; }

  select(...fields: string[]): this {
    this._projection = { ...(this._projection ?? {}) };
    for (const f of fields) (this._projection as Record<string, 1>)[f] = 1;
    return this;
  }

  page(pageNum: number, pageSize: number): this {
    this._limit = pageSize;
    this._offset = (pageNum - 1) * pageSize;
    return this;
  }

  async get(): Promise<Document[]> {
    return this.collection.find(this._filter, {
      sort: this._sort,
      limit: this._limit,
      offset: this._offset,
      projection: this._projection,
    }, this.options);
  }

  async first(): Promise<Document | null> {
    return this.collection.findOne(this._filter, {
      sort: this._sort,
      projection: this._projection,
    }, this.options);
  }

  async count(): Promise<number> {
    return this.collection.count(this._filter, this.options);
  }

  async paginate(page: number, pageSize: number): Promise<{
    data: Document[]; total: number; page: number; pageSize: number; totalPages: number;
  }> {
    this.page(page, pageSize);
    const [data, total] = await Promise.all([
      this.get(),
      this.collection.count(this._filter, this.options),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}

/**
 * JSDB Collection — primary API for database operations
 */
export class JSDBCollection {
  private defaultOptions: CollectionOptions;

  constructor(
    public readonly name: string,
    private adapter: DatabaseAdapter,
    private cache: CacheManager,
    private observability: ObservabilityManager,
    private security: SecurityManager,
    private config: JSDBConfig,
    defaultOptions?: CollectionOptions
  ) {
    this.defaultOptions = defaultOptions ?? {};
  }

  // ---- Query builder ----

  private mergeOptions(options?: CollectionOptions): CollectionOptions {
    if (!this.defaultOptions.tx) return options ?? {};
    return { ...options, tx: options?.tx ?? this.defaultOptions.tx };
  }

  query(options?: CollectionOptions): CollectionQueryChain {
    return new CollectionQueryChain(this, options);
  }

  where(filter: Filter, options?: CollectionOptions): CollectionQueryChain {
    return this.query(options).where(filter);
  }

  // ---- Find ----

  async find(filter: Filter = {}, options?: FindOptions, collOptions?: CollectionOptions): Promise<Document[]> {
    const opts = this.mergeOptions(collOptions);
    const reqId = opts.requestId ?? generateId();
    const trace = this.observability.startTrace('find', this.name, this.adapter.type, { requestId: reqId });

    // Apply tenant isolation
    const secCtx = collOptions?.securityContext;
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    // Check authorization
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'read');

    // Build IR and plan through capability analysis
    const ir = IRBuilder.find(this.name, effectiveFilter, options, { requestId: reqId });
    let plan = globalPlanCache.get(ir, this.adapter.type);
    if (!plan) {
      plan = queryPlanner.plan(ir, this.adapter.type);
      globalPlanCache.set(ir, this.adapter.type, plan);
    }

    // Cache lookup
    if (!collOptions?.skipCache) {
      const cacheKey = this.cache.buildKey([this.name, 'find', JSON.stringify(effectiveFilter), JSON.stringify(options ?? {})]);
      const cached = await this.cache.get<Document[]>(cacheKey);
      if (cached !== null) {
        trace.end({ cacheHit: true });
        return secCtx ? this.security.fieldAccess.filterDocuments(this.name, cached, secCtx) : cached;
      }
    }

    try {
      const result = await this.adapter.find(
        this.name,
        effectiveFilter,
        options,
        opts.tx
      );
      const docs = result.documents;

      // Cache result
      if (!collOptions?.skipCache) {
        const cacheKey = this.cache.buildKey([this.name, 'find', JSON.stringify(effectiveFilter), JSON.stringify(options ?? {})]);
        await this.cache.set(cacheKey, docs);
      }

      trace.end({ cacheHit: false });

      return secCtx
        ? this.security.fieldAccess.filterDocuments(this.name, docs, secCtx)
        : docs;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  async findOne(filter: Filter = {}, options?: FindOptions, collOptions?: CollectionOptions): Promise<Document | null> {
    const opts = this.mergeOptions(collOptions);
    const reqId = opts.requestId ?? generateId();
    const trace = this.observability.startTrace('findOne', this.name, this.adapter.type, { requestId: reqId });

    const secCtx = collOptions?.securityContext;
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'read');

    try {
      const doc = await this.adapter.findOne(this.name, effectiveFilter, options, opts.tx);
      trace.end({ cacheHit: false });
      if (!doc || !secCtx) return doc;
      return this.security.fieldAccess.filterDocument(this.name, doc, secCtx);
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  async findById(id: string, options?: FindOptions, collOptions?: CollectionOptions): Promise<Document | null> {
    // Try 'id' field first (MySQL convention), then '_id' (MongoDB convention)
    const doc = await this.findOne({ id } as Filter, options, collOptions);
    if (doc) return doc;
    return this.findOne({ _id: id } as Filter, options, collOptions);
  }

  // ---- Insert ----

  async insertOne(document: Document, collOptions?: CollectionOptions): Promise<InsertOneResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'write');

    const doc = secCtx
      ? this.security.tenantIsolation.injectDocument(document, secCtx)
      : document;

    const trace = this.observability.startTrace('insert', this.name, this.adapter.type);

    try {
      const result = await this.adapter.insert(this.name, doc, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  async insertMany(documents: Document[], collOptions?: CollectionOptions): Promise<InsertManyResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'write');

    const docs = secCtx
      ? documents.map((d) => this.security.tenantIsolation.injectDocument(d, secCtx))
      : documents;

    const trace = this.observability.startTrace('insertMany', this.name, this.adapter.type);
    try {
      const result = await this.adapter.insertMany(this.name, docs, {}, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  // ---- Update ----

  async updateOne(filter: Filter, update: Update, options?: { upsert?: boolean }, collOptions?: CollectionOptions): Promise<UpdateResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'write');
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    const trace = this.observability.startTrace('update', this.name, this.adapter.type);
    try {
      const result = await this.adapter.update(this.name, effectiveFilter, update, options, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  async updateMany(filter: Filter, update: Update, collOptions?: CollectionOptions): Promise<UpdateResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'write');
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    const trace = this.observability.startTrace('updateMany', this.name, this.adapter.type);
    try {
      const result = await this.adapter.updateMany(this.name, effectiveFilter, update, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  // ---- Delete ----

  async deleteOne(filter: Filter, collOptions?: CollectionOptions): Promise<DeleteResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'delete');
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    const trace = this.observability.startTrace('delete', this.name, this.adapter.type);
    try {
      const result = await this.adapter.delete(this.name, effectiveFilter, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  async deleteMany(filter: Filter, collOptions?: CollectionOptions): Promise<DeleteResult> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    if (secCtx) this.security.checkAuthorization(secCtx, this.name, 'delete');
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    const trace = this.observability.startTrace('deleteMany', this.name, this.adapter.type);
    try {
      const result = await this.adapter.deleteMany(this.name, effectiveFilter, opts.tx);
      await this.cache.invalidateCollection(this.name);
      trace.end({});
      return result;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  // ---- Count / Aggregate ----

  async count(filter: Filter = {}, collOptions?: CollectionOptions): Promise<number> {
    const opts = this.mergeOptions(collOptions);
    const secCtx = collOptions?.securityContext;
    const effectiveFilter = secCtx
      ? this.security.tenantIsolation.injectFilter(filter, secCtx)
      : filter;

    const result = await this.adapter.count(this.name, effectiveFilter, opts.tx);
    return result.count;
  }

  async aggregate(pipeline: AggregationStage[], collOptions?: CollectionOptions): Promise<Document[]> {
    const opts = this.mergeOptions(collOptions);
    const trace = this.observability.startTrace('aggregate', this.name, this.adapter.type);
    try {
      const result = await this.adapter.aggregate(this.name, pipeline, opts.tx);
      trace.end({});
      return result.documents;
    } catch (err) {
      trace.end({ error: (err as Error).message });
      throw err;
    }
  }

  // ---- Schema ops ----

  async createIndex(fields: string[], options?: {
    unique?: boolean; name?: string; sparse?: boolean; ttl?: number; fulltext?: boolean;
  }): Promise<void> {
    await this.adapter.createIndex(this.name, fields, options);
  }

  async dropIndex(indexName: string): Promise<void> {
    await this.adapter.dropIndex(this.name, indexName);
  }
}
