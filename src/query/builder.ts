// =====================================================
// JSDB - Fluent Query Builder
// Method-chaining API that builds IR
// =====================================================
import type {
  Filter,
  SortSpec,
  ProjectionSpec,
  AggregationStage,
  Document,
  FindOptions,
  SortDirection,
} from '../types/index.js';

/**
 * Fluent query builder — captures query parameters
 * that are later converted to IR when .get() / .first() / etc. is called
 */
export class QueryBuilder {
  private _collection: string;
  private _filter: Filter = {};
  private _sort: SortSpec = {};
  private _projection: ProjectionSpec = {};
  private _limit?: number;
  private _offset = 0;

  constructor(collection: string) {
    this._collection = collection;
  }

  // --- Filter methods ---

  where(field: string, operator: string, value: unknown): this;
  where(filter: Filter): this;
  where(fieldOrFilter: string | Filter, operator?: string, value?: unknown): this {
    if (typeof fieldOrFilter === 'string') {
      const field = fieldOrFilter;
      const op = operator ?? '=';
      const opMap: Record<string, string> = {
        '=': '$eq', '!=': '$ne', '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte',
        'in': '$in', 'not in': '$nin', 'like': '$like', 'ilike': '$ilike', 'regex': '$regex',
      };
      const mongoOp = opMap[op.toLowerCase()];
      if (!mongoOp) throw new Error(`Unknown operator: ${op}`);

      // Merge with existing filter
      if (!this._filter[field]) {
        this._filter[field] = { [mongoOp]: value };
      } else {
        (this._filter[field] as Record<string, unknown>)[mongoOp] = value;
      }
    } else {
      // Merge filter object
      Object.assign(this._filter, fieldOrFilter);
    }
    return this;
  }

  whereNull(field: string): this {
    this._filter[field] = null as unknown as Filter;
    return this;
  }

  whereNotNull(field: string): this {
    this._filter[field] = { $exists: true, $ne: null } as Filter;
    return this;
  }

  whereIn(field: string, values: unknown[]): this {
    this._filter[field] = { $in: values } as Filter;
    return this;
  }

  whereNotIn(field: string, values: unknown[]): this {
    this._filter[field] = { $nin: values } as Filter;
    return this;
  }

  whereLike(field: string, pattern: string): this {
    this._filter[field] = { $like: pattern } as Filter;
    return this;
  }

  orWhere(filters: Filter[]): this {
    if (this._filter.$or) {
      (this._filter.$or as Filter[]).push(...filters);
    } else {
      this._filter.$or = filters;
    }
    return this;
  }

  andWhere(filters: Filter[]): this {
    if (this._filter.$and) {
      (this._filter.$and as Filter[]).push(...filters);
    } else {
      this._filter.$and = filters;
    }
    return this;
  }

  // --- Sort methods ---

  orderBy(field: string, direction: SortDirection = 'asc'): this {
    this._sort[field] = direction;
    return this;
  }

  sortBy(field: string, direction: SortDirection = 'asc'): this {
    return this.orderBy(field, direction);
  }

  // --- Pagination methods ---

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  skip(n: number): this {
    return this.offset(n);
  }

  page(pageNum: number, pageSize: number): this {
    this._limit = pageSize;
    this._offset = (pageNum - 1) * pageSize;
    return this;
  }

  // --- Projection methods ---

  select(...fields: string[]): this {
    for (const f of fields) this._projection[f] = 1;
    return this;
  }

  project(projection: ProjectionSpec): this {
    this._projection = { ...this._projection, ...projection };
    return this;
  }

  exclude(...fields: string[]): this {
    for (const f of fields) this._projection[f] = 0;
    return this;
  }

  // --- Build methods ---

  toFilter(): Filter {
    return { ...this._filter };
  }

  toOptions(): FindOptions {
    return {
      sort: Object.keys(this._sort).length > 0 ? { ...this._sort } : undefined,
      projection: Object.keys(this._projection).length > 0 ? { ...this._projection } : undefined,
      limit: this._limit,
      offset: this._offset > 0 ? this._offset : undefined,
    };
  }

  getCollection(): string {
    return this._collection;
  }

  clone(): QueryBuilder {
    const q = new QueryBuilder(this._collection);
    q._filter = JSON.parse(JSON.stringify(this._filter));
    q._sort = { ...this._sort };
    q._projection = { ...this._projection };
    q._limit = this._limit;
    q._offset = this._offset;
    return q;
  }
}

// =====================================================
// Table Builder — table().where().get() style API
// =====================================================
export class TableQueryBuilder extends QueryBuilder {
  private executor: (builder: TableQueryBuilder) => Promise<unknown>;

  constructor(
    collection: string,
    executor: (builder: TableQueryBuilder) => Promise<unknown>
  ) {
    super(collection);
    this.executor = executor;
  }

  async get(): Promise<Document[]> {
    return this.executor(this) as Promise<Document[]>;
  }

  async first(): Promise<Document | null> {
    this.limit(1);
    const results = await this.executor(this) as Document[];
    return results[0] ?? null;
  }

  async count(): Promise<number> {
    return this.executor({ ...this, _isCount: true } as unknown as TableQueryBuilder) as Promise<number>;
  }

  async paginate(page: number, pageSize: number): Promise<{ data: Document[]; total: number; page: number; pageSize: number; totalPages: number }> {
    this.page(page, pageSize);
    const [data, total] = await Promise.all([
      this.executor(this) as Promise<Document[]>,
      this.executor({ ...this.clone(), _isCount: true } as unknown as TableQueryBuilder) as Promise<number>,
    ]);
    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
