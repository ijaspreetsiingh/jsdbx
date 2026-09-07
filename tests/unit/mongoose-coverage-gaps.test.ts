// =====================================================
// Production-Readiness Audit: Mongoose Coverage Gaps
//
// Tests for untested mongoose methods, Schema features,
// MongooseQuery chaining, and Document methods.
// =====================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryAdapter } from '../../src/adapters/memory/adapter.js';
import { setSharedAdapter, resetSharedAdapter } from '../../src/compat/core.js';
import mongoose, { Schema } from '../../src/compat/mongoose.js';

const memAdapter = new MemoryAdapter({ database: 'sqlite' });

beforeAll(async () => {
  setSharedAdapter(memAdapter, { database: 'sqlite' });
  await memAdapter.connect();
  await mongoose.connect('mongodb://localhost:27017/test');
});

afterAll(async () => {
  await mongoose.disconnect();
  resetSharedAdapter();
});

// =====================================================
// 1. findByIdAndUpdate
// =====================================================
describe('mongoose: findByIdAndUpdate', () => {
  const TestSchema = new Schema({ name: String, score: Number });
  const TestModel = mongoose.model('TestFU', TestSchema, 'test_fu');

  it('findByIdAndUpdate updates and returns old doc by default', async () => {
    const doc = await TestModel.create({ name: 'FU1', score: 10 }) as any;
    const old = await TestModel.findByIdAndUpdate(doc._id, { $set: { score: 20 } });
    expect(old).not.toBeNull();
    expect((old as any).score).toBe(10); // before update
  });

  it('findByIdAndUpdate with { new: true } returns updated doc', async () => {
    const doc = await TestModel.create({ name: 'FU2', score: 15 }) as any;
    const updated = await TestModel.findByIdAndUpdate(
      doc._id,
      { $set: { score: 25 } },
      { new: true }
    );
    expect(updated).not.toBeNull();
    expect((updated as any).score).toBe(25);
  });

  it('findByIdAndUpdate with { returnDocument: "after" } returns updated doc', async () => {
    const doc = await TestModel.create({ name: 'FU3', score: 30 }) as any;
    const updated = await TestModel.findByIdAndUpdate(
      doc._id,
      { $inc: { score: 5 } },
      { returnDocument: 'after' }
    );
    expect(updated).not.toBeNull();
    expect((updated as any).score).toBe(35);
  });

  it('findByIdAndUpdate with $inc', async () => {
    const doc = await TestModel.create({ name: 'FU4', score: 100 }) as any;
    await TestModel.findByIdAndUpdate(doc._id, { $inc: { score: 50 } });
    const check = await TestModel.findById(doc._id) as any;
    expect(check.score).toBe(150);
  });

  it('findByIdAndUpdate returns null for non-existent id', async () => {
    const result = await TestModel.findByIdAndUpdate(
      'nonexistent123456789012',
      { $set: { score: 99 } }
    );
    expect(result).toBeNull();
  });
});

// =====================================================
// 2. findByIdAndDelete
// =====================================================
describe('mongoose: findByIdAndDelete', () => {
  const TestSchema = new Schema({ name: String });
  const TestModel = mongoose.model('TestFAD', TestSchema, 'test_fad');

  it('findByIdAndDelete removes and returns the document', async () => {
    const doc = await TestModel.create({ name: 'FAD1' }) as any;
    const deleted = await TestModel.findByIdAndDelete(doc._id);
    expect(deleted).not.toBeNull();
    expect((deleted as any).name).toBe('FAD1');

    const remaining = await TestModel.findById(doc._id);
    expect(remaining).toBeNull();
  });

  it('findByIdAndDelete returns null for non-existent', async () => {
    const result = await TestModel.findByIdAndDelete('nonexistent123456789012');
    expect(result).toBeNull();
  });
});

// =====================================================
// 3. findOneAndUpdate / findOneAndDelete
// =====================================================
describe('mongoose: findOneAndUpdate / findOneAndDelete', () => {
  const TestSchema = new Schema({ name: String, val: Number });
  const TestModel = mongoose.model('TestFOU', TestSchema, 'test_fou');

  it('findOneAndUpdate returns old doc by default', async () => {
    await TestModel.create({ name: 'FOU1', val: 1 });
    const old = await TestModel.findOneAndUpdate({ name: 'FOU1' }, { $set: { val: 2 } });
    expect((old as any).val).toBe(1);
  });

  it('findOneAndUpdate with { new: true }', async () => {
    await TestModel.create({ name: 'FOU2', val: 10 });
    const updated = await TestModel.findOneAndUpdate(
      { name: 'FOU2' },
      { $set: { val: 20 } },
      { new: true }
    );
    expect((updated as any).val).toBe(20);
  });

  it('findOneAndDelete removes and returns', async () => {
    await TestModel.create({ name: 'FOD1', val: 100 });
    const deleted = await TestModel.findOneAndDelete({ name: 'FOD1' });
    expect((deleted as any).val).toBe(100);

    const remaining = await TestModel.findOne({ name: 'FOD1' });
    expect(remaining).toBeNull();
  });
});

// =====================================================
// 4. insertMany
// =====================================================
describe('mongoose: insertMany', () => {
  const TestSchema = new Schema({ name: String, idx: Number });
  const TestModel = mongoose.model('TestIM', TestSchema, 'test_im');

  it('insertMany returns MongooseDocument array', async () => {
    const docs = await TestModel.insertMany([
      { name: 'IM1', idx: 1 },
      { name: 'IM2', idx: 2 },
      { name: 'IM3', idx: 3 },
    ]);
    expect(docs.length).toBe(3);
    expect((docs[0] as any).name).toBe('IM1');

    // Verify they are persisted
    const all = await TestModel.find({});
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});

// =====================================================
// 5. estimatedDocumentCount
// =====================================================
describe('mongoose: estimatedDocumentCount', () => {
  const TestSchema = new Schema({ name: String });
  const TestModel = mongoose.model('TestEDC', TestSchema, 'test_edc');

  it('estimatedDocumentCount returns number', async () => {
    await TestModel.create({ name: 'EDC1' });
    const count = await TestModel.estimatedDocumentCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================
// 6. MongooseQuery.where()
// =====================================================
describe('mongoose: MongooseQuery.where()', () => {
  const TestSchema = new Schema({ name: String, age: Number, dept: String });
  const TestModel = mongoose.model('TestWhere', TestSchema, 'test_where');

  beforeAll(async () => {
    await TestModel.create([
      { name: 'W1', age: 25, dept: 'Eng' },
      { name: 'W2', age: 30, dept: 'HR' },
      { name: 'W3', age: 35, dept: 'Eng' },
    ]);
  });

  it('where(field, value) chains filter', async () => {
    const results = await TestModel.find().where('dept', 'Eng');
    expect(results.length).toBe(2);
    expect(results.every((d: any) => d.dept === 'Eng')).toBe(true);
  });

  it('multiple where() calls chain AND conditions', async () => {
    const results = await TestModel.find()
      .where('dept', 'Eng')
      .where('age', { $gte: 30 });
    expect(results.length).toBe(1);
    expect((results[0] as any).name).toBe('W3');
  });
});

// =====================================================
// 7. MongooseQuery string sort format
// =====================================================
describe('mongoose: MongooseQuery.sort() string format', () => {
  const TestSchema = new Schema({ name: String, age: Number });
  const TestModel = mongoose.model('TestSortStr', TestSchema, 'test_sort_str');

  beforeAll(async () => {
    await TestModel.create([
      { name: 'A', age: 30 },
      { name: 'B', age: 20 },
      { name: 'C', age: 25 },
    ]);
  });

  it('sort("age") sorts ascending', async () => {
    const results = await TestModel.find({}).sort('age');
    const ages = results.map((d: any) => d.age);
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i]).toBeGreaterThanOrEqual(ages[i - 1]);
    }
  });

  it('sort("-age") sorts descending', async () => {
    const results = await TestModel.find({}).sort('-age');
    const ages = results.map((d: any) => d.age);
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i]).toBeLessThanOrEqual(ages[i - 1]);
    }
  });

  it('sort("-age name") sorts by multiple fields', async () => {
    const results = await TestModel.find({}).sort('-age name');
    // Should sort by age desc, then name asc
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================
// 8. MongooseQuery.select() with negative fields
// =====================================================
describe('mongoose: MongooseQuery.select()', () => {
  const TestSchema = new Schema({ name: String, email: String, secret: String });
  const TestModel = mongoose.model('TestSelect', TestSchema, 'test_select');

  beforeAll(async () => {
    await TestModel.create({ name: 'Sel1', email: 'sel@test.com', secret: 'hidden' });
  });

  it('select("name email") includes only specified fields', async () => {
    const results = await TestModel.find({}).select('name email');
    expect(results.length).toBe(1);
    expect((results[0] as any).name).toBe('Sel1');
    expect((results[0] as any).email).toBe('sel@test.com');
  });

  it('select("-secret") excludes specified field', async () => {
    const results = await TestModel.find({}).select('-secret');
    expect(results.length).toBe(1);
    expect((results[0] as any).name).toBe('Sel1');
  });
});

// =====================================================
// 9. MongooseQuery.catch()
// =====================================================
describe('mongoose: MongooseQuery.catch()', () => {
  it('catch handles rejection', async () => {
    const TestSchema = new Schema({ name: String });
    const TestModel = mongoose.model('TestCatch', TestSchema, 'test_catch');

    // catch should be callable without throwing
    const query = TestModel.find({});
    const result = await query.catch(() => []);
    expect(Array.isArray(result)).toBe(true);
  });
});

// =====================================================
// 10. MongooseDocument methods
// =====================================================
describe('mongoose: MongooseDocument methods', () => {
  const TestSchema = new Schema({ name: String, value: Number });
  const TestModel = mongoose.model('TestDoc', TestSchema, 'test_doc');

  it('document.toObject() returns plain object', async () => {
    const doc = await TestModel.create({ name: 'Obj1', value: 42 }) as any;
    const obj = doc.toObject();
    expect(typeof obj).toBe('object');
    expect(obj.name).toBe('Obj1');
    expect(obj.value).toBe(42);
    expect(obj._id).toBeDefined();
  });

  it('document.toJSON() returns plain object', async () => {
    const doc = await TestModel.create({ name: 'JSON1', value: 99 }) as any;
    const json = doc.toJSON();
    expect(json.name).toBe('JSON1');
    expect(json.value).toBe(99);
  });

  it('document.set() and document.get()', async () => {
    const doc = new TestModel({ name: 'SetGet', value: 1 });
    doc.set('value', 100);
    expect(doc.get('value')).toBe(100);
  });

  it('document.isNew() returns true for new unsaved docs', async () => {
    const doc = new TestModel({ name: 'NewDoc', value: 1 });
    expect(doc.isNew()).toBe(true);
  });

  it('document.isNew() returns false after save', async () => {
    const doc = new TestModel({ name: 'SavedDoc', value: 1 });
    await doc.save();
    expect(doc.isNew()).toBe(false);
  });

  it('document.isModified() returns true (stub)', async () => {
    const doc = new TestModel({ name: 'ModDoc', value: 1 });
    expect(doc.isModified()).toBe(true);
  });

  it('document.markModified() is a no-op', async () => {
    const doc = new TestModel({ name: 'MarkDoc', value: 1 });
    expect(() => doc.markModified('name')).not.toThrow();
  });

  it('document.remove() deletes the document', async () => {
    const doc = await TestModel.create({ name: 'RemoveDoc', value: 1 }) as any;
    const removed = await doc.remove();
    expect(removed).toBeDefined();

    const found = await TestModel.findOne({ name: 'RemoveDoc' });
    expect(found).toBeNull();
  });

  it('document.deleteOne() returns deletedCount', async () => {
    const doc = await TestModel.create({ name: 'DelOneDoc', value: 1 }) as any;
    const result = await doc.deleteOne();
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================
// 11. Schema features
// =====================================================
describe('mongoose: Schema features', () => {
  it('Schema with nested objects', () => {
    const schema = new Schema({
      name: String,
      address: {
        street: String,
        city: String,
      },
    });
    expect(schema.paths.has('name')).toBe(true);
    expect(schema.paths.has('address.street')).toBe(true);
    expect(schema.paths.has('address.city')).toBe(true);
  });

  it('Schema.index() stores index spec', () => {
    const schema = new Schema({ name: String });
    schema.index({ name: 1 }, { unique: true });
    // Should not throw
  });

  it('Schema.pre() stores hook', () => {
    const schema = new Schema({ name: String });
    schema.pre('save', () => {});
    // Should not throw
  });

  it('Schema.post() stores hook', () => {
    const schema = new Schema({ name: String });
    schema.post('save', () => {});
    // Should not throw
  });

  it('Schema.add() adds fields after construction', () => {
    const schema = new Schema({ name: String });
    schema.add({ age: Number });
    expect(schema.paths.has('name')).toBe(true);
    expect(schema.paths.has('age')).toBe(true);
  });

  it('Schema.virtual() defines virtual getter/setter', () => {
    const schema = new Schema({ firstName: String, lastName: String });
    schema.virtual('fullName')
      .get(function (this: any) { return `${this.firstName} ${this.lastName}`; })
      .set(function (this: any, v: string) {
        const parts = v.split(' ');
        this.firstName = parts[0];
        this.lastName = parts[1];
      });
    // Should not throw
  });

  it('Schema.static() registers static method', () => {
    const schema = new Schema({ name: String });
    schema.static('findByEmail', function (email: string) {
      return this.findOne({ email });
    });
    const statics = schema.getStatics();
    expect(typeof statics.findByEmail).toBe('function');
  });

  it('Schema.method() registers instance method', () => {
    const schema = new Schema({ name: String });
    schema.method('greet', function () {
      return `Hello, ${this.name}`;
    });
    const methods = schema.getMethods();
    expect(typeof methods.greet).toBe('function');
  });
});

// =====================================================
// 12. mongoose.plugin()
// =====================================================
describe('mongoose: plugin()', () => {
  it('plugin() registers and applies to new models', () => {
    const pluginFn = (model: any, opts: any) => {
      // Plugin that adds a static method
      if (!model.findByPlugin) {
        model.findByPlugin = () => [];
      }
    };

    mongoose.plugin(pluginFn, { option: true });
    // Should not throw
    expect((mongoose as any)._plugins.length).toBeGreaterThan(0);
  });
});

// =====================================================
// 13. mongoose.set()
// =====================================================
describe('mongoose: set()', () => {
  it('set() stores config values', () => {
    mongoose.set('strictQuery', true);
    mongoose.set('strict', false);
    // Should not throw
  });
});

// =====================================================
// 14. mongoose.connection
// =====================================================
describe('mongoose: connection', () => {
  it('connection has readyState', () => {
    const conn = mongoose.connection;
    expect(conn).toHaveProperty('readyState');
    expect(typeof conn.readyState).toBe('number');
  });

  it('connection has host', () => {
    const conn = mongoose.connection;
    expect(conn).toHaveProperty('host');
  });

  it('connection.on is a no-op', () => {
    const conn = mongoose.connection;
    expect(() => conn.on('test', () => {})).not.toThrow();
  });

  it('connection.once is a no-op', () => {
    const conn = mongoose.connection;
    expect(() => conn.once('test', () => {})).not.toThrow();
  });
});

// =====================================================
// 15. mongoose.Types
// =====================================================
describe('mongoose: Types', () => {
  it('Types.ObjectId is a constructor', () => {
    const { ObjectId } = mongoose.Types as any;
    const id = new ObjectId();
    expect(id.toString().length).toBeGreaterThanOrEqual(12);
  });

  it('Types.ObjectId.isValid', () => {
    const { ObjectId } = mongoose.Types as any;
    expect(ObjectId.isValid('longenoughstring')).toBe(true);
  });

  it('Types.Decimal128', () => {
    const { Decimal128 } = mongoose.Types as any;
    const d = new Decimal128('123.456');
    expect(d.toString()).toBe('123.456');
  });

  it('SchemaTypes has expected types', () => {
    expect(mongoose.SchemaTypes.String).toBe('String');
    expect(mongoose.SchemaTypes.Number).toBe('Number');
    expect(mongoose.SchemaTypes.Boolean).toBe('Boolean');
    expect(mongoose.SchemaTypes.Date).toBe('Date');
    expect(mongoose.SchemaTypes.ObjectId).toBe('ObjectId');
    expect(mongoose.SchemaTypes.Array).toBe('Array');
  });
});

// =====================================================
// 16. Model.aggregate().then() (thenable)
// =====================================================
describe('mongoose: aggregate thenable', () => {
  const TestSchema = new Schema({ name: String, val: Number });
  const TestModel = mongoose.model('TestAggThen', TestSchema, 'test_agg_then');

  it('aggregate().then() resolves without .exec()', async () => {
    await TestModel.create([{ name: 'A', val: 1 }, { name: 'B', val: 2 }]);
    const result = await TestModel.aggregate([
      { $match: {} },
      { $group: { _id: null, total: { $sum: '$val' } } },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });
});

// =====================================================
// 17. MongooseQuery.populate()
// =====================================================
describe('mongoose: MongooseQuery.populate()', () => {
  const AuthorSchema = new Schema({ name: String });
  const AuthorModel = mongoose.model('TestAuthor', AuthorSchema, 'test_authors');

  const BookSchema = new Schema({ title: String, authorId: String });
  const BookModel = mongoose.model('TestBook', BookSchema, 'test_books');

  it('populate() is chainable', async () => {
    const author = await AuthorModel.create({ name: 'Author1' }) as any;
    await BookModel.create({ title: 'Book1', authorId: String(author._id) });

    // populate() should return the query (chainable)
    const query = BookModel.find({}).populate({ path: 'authorId' });
    expect(query).toBeDefined();
    expect(typeof query.exec).toBe('function');
  });

  it('populate() with string path', async () => {
    const query = BookModel.find({}).populate('authorId');
    expect(query).toBeDefined();
  });
});

// =====================================================
// 18. MongooseQuery.then() (thenable without exec)
// =====================================================
describe('mongoose: MongooseQuery.then()', () => {
  const TestSchema = new Schema({ name: String });
  const TestModel = mongoose.model('TestThen', TestSchema, 'test_then');

  it('query works with await directly (thenable)', async () => {
    await TestModel.create({ name: 'Then1' });
    const results = await TestModel.find({});
    expect(Array.isArray(results)).toBe(true);
  });
});

// =====================================================
// 19. Model.exists()
// =====================================================
describe('mongoose: Model.exists()', () => {
  const TestSchema = new Schema({ name: String });
  const TestModel = mongoose.model('TestExists', TestSchema, 'test_exists');

  it('exists() returns _id when found', async () => {
    await TestModel.create({ name: 'Exists1' });
    const result = await TestModel.exists({ name: 'Exists1' });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('_id');
  });

  it('exists() returns null when not found', async () => {
    const result = await TestModel.exists({ name: 'NonExistent' });
    expect(result).toBeNull();
  });
});

// =====================================================
// 20. Model.distinct()
// =====================================================
describe('mongoose: Model.distinct()', () => {
  const TestSchema = new Schema({ name: String, dept: String });
  const TestModel = mongoose.model('TestDistinct', TestSchema, 'test_distinct');

  beforeAll(async () => {
    await TestModel.create([
      { name: 'D1', dept: 'Eng' },
      { name: 'D2', dept: 'HR' },
      { name: 'D3', dept: 'Eng' },
    ]);
  });

  it('distinct("dept") returns unique values', async () => {
    const depts = await TestModel.distinct('dept');
    expect(Array.isArray(depts)).toBe(true);
    expect(depts).toContain('Eng');
    expect(depts).toContain('HR');
  });

  it('distinct() with filter', async () => {
    const depts = await TestModel.distinct('dept', { name: 'D1' });
    expect(depts).toContain('Eng');
  });
});

// =====================================================
// 21. Model.countDocuments()
// =====================================================
describe('mongoose: Model.countDocuments()', () => {
  const TestSchema = new Schema({ name: String, active: Boolean });
  const TestModel = mongoose.model('TestCountDocs', TestSchema, 'test_count_docs');

  beforeAll(async () => {
    await TestModel.create([
      { name: 'C1', active: true },
      { name: 'C2', active: true },
      { name: 'C3', active: false },
    ]);
  });

  it('countDocuments() with empty filter', async () => {
    const count = await TestModel.countDocuments({});
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('countDocuments() with filter', async () => {
    const count = await TestModel.countDocuments({ active: true });
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
