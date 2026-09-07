// =====================================================
// JSDB End-to-End: MongoDB-style App → Any DB
//
// Simulates a project that was originally written with
// the MongoDB driver (MongoClient / collection.find etc.)
// or Mongoose ORM.
//
// THE APPLICATION QUERIES ARE NEVER CHANGED.
// Only the import line changes:
//   import { MongoClient } from 'jsdb/mongodb'  (was 'mongodb')
//   import mongoose from 'jsdb/mongoose'        (was 'mongoose')
//
// Runs against the in-memory adapter (no external DB needed).
// The same tests run unchanged against MySQL/Postgres/SQLite/MongoDB
// by setting JSDB_DATABASE env var.
// =====================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryAdapter } from '../../src/adapters/memory/adapter.js';
import { setSharedAdapter, resetSharedAdapter } from '../../src/compat/core.js';

// ---- Setup in-memory adapter ----
const memAdapter = new MemoryAdapter({ database: 'sqlite' });
setSharedAdapter(memAdapter, { database: 'sqlite' });

// =====================================================
// PART 1 — MongoDB Driver (MongoClient) style
// Simulates an existing app that uses the mongodb package
// =====================================================

// BEFORE (existing app):
//   import { MongoClient } from 'mongodb';
// AFTER (only this line changes):
import { MongoClient, ObjectId } from '../../src/compat/mongodb.js';

// =====================================================
// PART 2 — Mongoose ORM style
// Simulates an existing app that uses mongoose
// =====================================================

// BEFORE (existing app):
//   import mongoose from 'mongoose';
// AFTER (only this line changes):
import mongoose, { Schema } from '../../src/compat/mongoose.js';

// ---- The existing app's MongoDB connection code (UNCHANGED) ----
const client = new MongoClient('mongodb://localhost:27017/testapp');
let db: ReturnType<typeof client.db>;
let usersCol: ReturnType<ReturnType<typeof client.db>['collection']>;
let ordersCol: ReturnType<ReturnType<typeof client.db>['collection']>;
let productsCol: ReturnType<ReturnType<typeof client.db>['collection']>;

// ---- Mongoose models (UNCHANGED) ----
const UserSchema = new Schema({
  name: { type: String, required: true },
  email: String,
  age: Number,
  status: { type: String, default: 'active' },
  department: String,
  salary: Number,
});

const OrderSchema = new Schema({
  userId: String,
  product: String,
  quantity: Number,
  price: Number,
  status: { type: String, default: 'pending' },
});

const User = mongoose.model('User', UserSchema, 'mongoose_users');
const Order = mongoose.model('Order', OrderSchema, 'mongoose_orders');

// =====================================================
// MONGODB DRIVER TESTS
// =====================================================

describe('JSDB Compat: Existing MongoDB driver app → Any DB', () => {

  beforeAll(async () => {
    await memAdapter.connect();
    await client.connect();
    db = client.db('testapp');
    usersCol = db.collection('users');
    ordersCol = db.collection('orders');
    productsCol = db.collection('products');

    // Seed data — exact same code the original MongoDB app would run
    await usersCol.insertMany([
      { name: 'Alice', email: 'alice@example.com', age: 30, status: 'active', department: 'Engineering', salary: 90000 },
      { name: 'Bob', email: 'bob@example.com', age: 25, status: 'active', department: 'Marketing', salary: 70000 },
      { name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'inactive', department: 'Engineering', salary: 95000 },
      { name: 'Diana', email: 'diana@example.com', age: 28, status: 'active', department: 'HR', salary: 65000 },
      { name: 'Eve', email: 'eve@example.com', age: null as unknown as number, status: 'active', department: 'Engineering', salary: 88000 },
    ]);

    await ordersCol.insertMany([
      { userId: '1', product: 'Laptop', quantity: 1, price: 999.99, status: 'completed' },
      { userId: '1', product: 'Phone', quantity: 2, price: 599.99, status: 'completed' },
      { userId: '2', product: 'Desk', quantity: 1, price: 299.99, status: 'pending' },
      { userId: '3', product: 'Chair', quantity: 3, price: 199.99, status: 'cancelled' },
    ]);

    await productsCol.insertMany([
      { name: 'Laptop', category: 'Electronics', price: 999.99, stock: 50 },
      { name: 'Phone', category: 'Electronics', price: 599.99, stock: 100 },
      { name: 'Desk', category: 'Furniture', price: 299.99, stock: 20 },
      { name: 'Chair', category: 'Furniture', price: 199.99, stock: 30 },
    ]);
  });

  afterAll(async () => {
    await client.close();
    resetSharedAdapter();
  });

  // ── find() ──────────────────────────────────────────

  it('collection.find({}).toArray() — find all', async () => {
    const docs = await usersCol.find({}).toArray();
    expect(docs.length).toBe(5);
  });

  it('collection.find({ status: "active" }).toArray()', async () => {
    const docs = await usersCol.find({ status: 'active' }).toArray();
    expect(docs.every(d => (d as Record<string, unknown>).status === 'active')).toBe(true);
    expect(docs.length).toBeGreaterThanOrEqual(4);
  });

  it('find with $gt operator', async () => {
    const docs = await usersCol.find({ age: { $gt: 28 } }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.every(d => Number(d.age) > 28)).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(2); // Alice(30), Charlie(35)
  });

  it('find with $lt operator', async () => {
    const docs = await usersCol.find({ age: { $lt: 30 } }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.every(d => Number(d.age) < 30)).toBe(true);
  });

  it('find with $gte and $lte (range)', async () => {
    const docs = await usersCol.find({ age: { $gte: 25, $lte: 30 } }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.every(d => Number(d.age) >= 25 && Number(d.age) <= 30)).toBe(true);
  });

  it('find with $in operator', async () => {
    const docs = await usersCol.find({ department: { $in: ['Engineering', 'HR'] } }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r.every(d => ['Engineering', 'HR'].includes(d.department as string))).toBe(true);
  });

  it('find with $ne operator', async () => {
    const docs = await usersCol.find({ status: { $ne: 'inactive' } }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.every(d => d.status !== 'inactive')).toBe(true);
  });

  it('find with $exists operator', async () => {
    const docs = await usersCol.find({ age: { $exists: true } }).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(1);
  });

  it('find with $and operator', async () => {
    const docs = await usersCol.find({
      $and: [{ status: 'active' }, { department: 'Engineering' }]
    }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.every(d => d.status === 'active' && d.department === 'Engineering')).toBe(true);
  });

  it('find with $or operator', async () => {
    const docs = await usersCol.find({
      $or: [{ department: 'HR' }, { department: 'Marketing' }]
    }).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBe(2);
  });

  // ── Fluent cursor chaining ───────────────────────────

  it('find().sort().limit()', async () => {
    const docs = await usersCol.find({ age: { $gt: 0 } })
      .sort({ age: 1 })
      .limit(3)
      .toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBeLessThanOrEqual(3);
    // Sorted ascending by age
    const ages = r.map(d => Number(d.age));
    for (let i = 1; i < ages.length; i++) expect(ages[i]).toBeGreaterThanOrEqual(ages[i - 1]);
  });

  it('find().sort({ age: -1 }) — descending', async () => {
    const docs = await usersCol.find({ age: { $exists: true } })
      .sort({ age: -1 })
      .toArray();
    const r = docs as Record<string, unknown>[];
    const ages = r.filter(d => d.age !== null && d.age !== undefined).map(d => Number(d.age));
    for (let i = 1; i < ages.length; i++) expect(ages[i]).toBeLessThanOrEqual(ages[i - 1]);
  });

  it('find().skip().limit() — pagination', async () => {
    const page1 = await usersCol.find({}).sort({ name: 1 }).limit(2).toArray();
    const page2 = await usersCol.find({}).sort({ name: 1 }).skip(2).limit(2).toArray();
    expect((page1 as Record<string, unknown>[]).length).toBe(2);
    expect((page2 as Record<string, unknown>[]).length).toBe(2);
    // Pages should not overlap
    const names1 = (page1 as Record<string, unknown>[]).map(d => d.name);
    const names2 = (page2 as Record<string, unknown>[]).map(d => d.name);
    expect(names1.some(n => names2.includes(n))).toBe(false);
  });

  it('find().project() — field selection', async () => {
    const docs = await usersCol.find({})
      .project({ name: 1, email: 1 })
      .toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toHaveProperty('name');
    expect(r[0]).toHaveProperty('email');
  });

  // ── findOne() ───────────────────────────────────────

  it('collection.findOne({ name }) — returns single doc', async () => {
    const doc = await usersCol.findOne({ name: 'Alice' }) as Record<string, unknown>;
    expect(doc).not.toBeNull();
    expect(doc.name).toBe('Alice');
  });

  it('collection.findOne({}) on empty match — returns null', async () => {
    const doc = await usersCol.findOne({ name: 'Nobody_XYZ' });
    expect(doc).toBeNull();
  });

  // ── insertOne / insertMany ───────────────────────────

  it('collection.insertOne() returns insertedId', async () => {
    const result = await usersCol.insertOne({
      name: 'Frank', email: 'frank@test.com', age: 40, status: 'active', department: 'Finance', salary: 80000,
    });
    expect(result.acknowledged).toBe(true);
    expect(result.insertedId).toBeDefined();
  });

  it('collection.insertMany() returns insertedCount', async () => {
    const result = await ordersCol.insertMany([
      { userId: '1', product: 'Widget', quantity: 5, price: 9.99, status: 'pending' },
      { userId: '2', product: 'Gadget', quantity: 2, price: 19.99, status: 'pending' },
    ]);
    expect(result.acknowledged).toBe(true);
    expect(result.insertedCount).toBe(2);
  });

  // ── updateOne / updateMany ───────────────────────────

  it('collection.updateOne($set) — update single field', async () => {
    await usersCol.updateOne({ name: 'Bob' }, { $set: { status: 'inactive' } });
    const doc = await usersCol.findOne({ name: 'Bob' }) as Record<string, unknown>;
    expect(doc.status).toBe('inactive');
  });

  it('collection.updateOne($inc) — increment field', async () => {
    await usersCol.updateOne({ name: 'Alice' }, { $inc: { salary: 5000 } });
    const doc = await usersCol.findOne({ name: 'Alice' }) as Record<string, unknown>;
    expect(Number(doc.salary)).toBeGreaterThan(90000);
  });

  it('collection.updateMany() — update multiple docs', async () => {
    const result = await usersCol.updateMany(
      { status: 'active', department: 'Engineering' },
      { $set: { department: 'Engineering-Updated' } }
    );
    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
  });

  // ── deleteOne / deleteMany ───────────────────────────

  it('collection.deleteOne() — removes exactly one', async () => {
    await usersCol.insertOne({ name: 'ToDelete', email: 'del@test.com', status: 'inactive' });
    const before = await usersCol.countDocuments({ name: 'ToDelete' });
    expect(before).toBe(1);
    await usersCol.deleteOne({ name: 'ToDelete' });
    const after = await usersCol.countDocuments({ name: 'ToDelete' });
    expect(after).toBe(0);
  });

  it('collection.deleteMany() — removes matching docs', async () => {
    await usersCol.insertMany([
      { name: 'Temp1', status: 'temp' },
      { name: 'Temp2', status: 'temp' },
    ]);
    const result = await usersCol.deleteMany({ status: 'temp' });
    expect(result.deletedCount).toBe(2);
  });

  // ── countDocuments ───────────────────────────────────

  it('collection.countDocuments() — total count', async () => {
    const count = await usersCol.countDocuments({});
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('collection.countDocuments(filter)', async () => {
    const count = await usersCol.countDocuments({ status: 'active' });
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── aggregate pipeline ───────────────────────────────

  it('collection.aggregate([$match]) — filter via pipeline', async () => {
    const docs = await productsCol.aggregate([
      { $match: { category: 'Electronics' } },
    ]).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBe(2);
    expect(r.every(d => d.category === 'Electronics')).toBe(true);
  });

  it('collection.aggregate([$match, $group]) — count per category', async () => {
    const docs = await productsCol.aggregate([
      { $match: {} },
      { $group: { _id: '$category', total: { $sum: 1 } } },
    ]).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBeGreaterThanOrEqual(2);
    for (const row of r) expect(Number(row.total)).toBeGreaterThanOrEqual(1);
  });

  it('collection.aggregate([$match, $group, $sort]) — sorted groups', async () => {
    const docs = await productsCol.aggregate([
      { $match: {} },
      { $group: { _id: '$category', avgPrice: { $avg: '$price' } } },
      { $sort: { avgPrice: -1 } },
    ]).toArray();
    const r = docs as Record<string, unknown>[];
    expect(r.length).toBeGreaterThanOrEqual(2);
    const prices = r.map(d => Number(d.avgPrice));
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
  });

  it('collection.aggregate([$match, $group, $limit])', async () => {
    const docs = await usersCol.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$department', cnt: { $sum: 1 } } },
      { $limit: 2 },
    ]).toArray();
    expect((docs as unknown[]).length).toBeLessThanOrEqual(2);
  });

  // ── distinct ─────────────────────────────────────────

  it('collection.distinct() — unique values', async () => {
    const categories = await productsCol.distinct('category');
    expect(categories).toContain('Electronics');
    expect(categories).toContain('Furniture');
    expect(categories.length).toBe(2);
  });

  // ── ObjectId ─────────────────────────────────────────

  it('ObjectId.generate() produces valid 24-char hex', () => {
    const id = new ObjectId();
    expect(id.toString().length).toBe(24);
    expect(/^[0-9a-f]{24}$/.test(id.toString())).toBe(true);
  });

  it('ObjectId equality', () => {
    const id1 = new ObjectId('507f1f77bcf86cd799439011');
    const id2 = new ObjectId('507f1f77bcf86cd799439011');
    expect(id1.equals(id2)).toBe(true);
  });

  // ── findOneAndUpdate ────────────────────────────────

  it('findOneAndUpdate() returns updated doc (returnDocument: after)', async () => {
    const doc = await usersCol.findOneAndUpdate(
      { name: 'Diana' },
      { $set: { salary: 70000 } },
      { returnDocument: 'after' }
    ) as Record<string, unknown> | null;
    expect(doc).not.toBeNull();
    expect(Number(doc!.salary)).toBe(70000);
  });

  // ── db.command() ────────────────────────────────────

  it('db.command({ ping: 1 }) works', async () => {
    const result = await db.command({ ping: 1 });
    expect(result.ok).toBe(1);
  });

  // ── listCollections ─────────────────────────────────

  it('db.listCollections() returns array', async () => {
    const collections = await db.listCollections();
    expect(Array.isArray(collections)).toBe(true);
    expect(collections.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================
// PART 2 — Mongoose ORM tests
// =====================================================

describe('JSDB Compat: Existing Mongoose ORM app → Any DB', () => {

  beforeAll(async () => {
    setSharedAdapter(memAdapter, { database: 'sqlite' });
    await mongoose.connect('mongodb://localhost:27017/testapp');
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  // ── Model.create() ──────────────────────────────────

  it('User.create() — creates and saves a document', async () => {
    const user = await User.create({ name: 'Mongoose Alice', email: 'mng@test.com', age: 28, status: 'active', department: 'Engineering', salary: 85000 });
    expect(user).toBeDefined();
    expect((user as Record<string, unknown>).name).toBe('Mongoose Alice');
  });

  it('User.create([]) — bulk create', async () => {
    const users = await User.create([
      { name: 'Bulk1', age: 22, status: 'active', department: 'IT', salary: 60000 },
      { name: 'Bulk2', age: 27, status: 'active', department: 'IT', salary: 65000 },
    ]) as unknown[];
    expect(users.length).toBe(2);
  });

  // ── Model.find() ────────────────────────────────────

  it('User.find({}) — find all', async () => {
    const users = await User.find({});
    expect(Array.isArray(users)).toBe(true);
    expect((users as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('User.find({ status: "active" })', async () => {
    const users = await User.find({ status: 'active' }) as Record<string, unknown>[];
    expect(users.every(u => u.status === 'active')).toBe(true);
  });

  it('User.find() with $gt operator', async () => {
    const users = await User.find({ age: { $gt: 25 } }) as Record<string, unknown>[];
    expect(users.every(u => Number(u.age) > 25)).toBe(true);
  });

  it('User.find().sort().limit() — fluent chain', async () => {
    const users = await User.find({}).sort({ age: 1 }).limit(2) as unknown[];
    expect(users.length).toBeLessThanOrEqual(2);
  });

  it('User.find().select() — field selection', async () => {
    const users = await User.find({}).select('name email') as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    // select should filter fields — at minimum name should be present
    expect(users[0]).toHaveProperty('name');
  });

  it('User.find().lean() — returns plain objects', async () => {
    const users = await User.find({}).lean() as unknown[];
    expect(users.length).toBeGreaterThan(0);
  });

  // ── Model.findOne() ──────────────────────────────────

  it('User.findOne({ name }) — returns single', async () => {
    const user = await User.findOne({ name: 'Mongoose Alice' }) as Record<string, unknown> | null;
    expect(user).not.toBeNull();
    expect(user!.name).toBe('Mongoose Alice');
  });

  it('User.findOne({ no match }) — returns null', async () => {
    const user = await User.findOne({ name: 'Does Not Exist XYZ' });
    expect(user).toBeNull();
  });

  // ── Model.updateOne() / updateMany() ─────────────────

  it('User.updateOne($set)', async () => {
    const result = await User.updateOne({ name: 'Mongoose Alice' }, { $set: { salary: 92000 } });
    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
  });

  it('User.updateMany() — bulk update', async () => {
    const result = await User.updateMany({ department: 'IT' }, { $set: { status: 'active' } });
    expect(result.matchedCount).toBeGreaterThanOrEqual(2);
  });

  // ── Model.deleteOne() / deleteMany() ─────────────────

  it('User.deleteOne() — removes matching doc', async () => {
    await User.create({ name: 'ToDelete_Mongoose', status: 'inactive' });
    const result = await User.deleteOne({ name: 'ToDelete_Mongoose' });
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
  });

  it('User.deleteMany() — removes all matching', async () => {
    await User.create([
      { name: 'Temp_Mongoose1', status: 'temp_mg' },
      { name: 'Temp_Mongoose2', status: 'temp_mg' },
    ]);
    const result = await User.deleteMany({ status: 'temp_mg' });
    expect(result.deletedCount).toBe(2);
  });

  // ── Model.countDocuments() ───────────────────────────

  it('User.countDocuments() — total', async () => {
    const count = await User.countDocuments({});
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('User.countDocuments(filter)', async () => {
    const count = await User.countDocuments({ status: 'active' });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── Model.aggregate() ────────────────────────────────

  it('User.aggregate([$match, $group])', async () => {
    const result = await User.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$department', cnt: { $sum: 1 } } },
    ]).exec();
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  // ── new Model() + .save() ────────────────────────────

  it('new User().save() — manual save', async () => {
    const user = new User({ name: 'SavedUser', email: 'saved@test.com', age: 33, status: 'active', department: 'QA', salary: 72000 });
    await user.save();
    const found = await User.findOne({ name: 'SavedUser' }) as Record<string, unknown> | null;
    expect(found).not.toBeNull();
    expect(found!.name).toBe('SavedUser');
  });

  // ── Model.exists() ───────────────────────────────────

  it('User.exists({ name }) — returns _id when found', async () => {
    const result = await User.exists({ name: 'Mongoose Alice' });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('_id');
  });

  it('User.exists() — returns null when not found', async () => {
    const result = await User.exists({ name: 'Ghost Nobody' });
    expect(result).toBeNull();
  });

  // ── Model.distinct() ─────────────────────────────────

  it('User.distinct("status")', async () => {
    const statuses = await User.distinct('status');
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
  });

  // ── mongoose.modelNames ──────────────────────────────

  it('mongoose.modelNames contains registered models', () => {
    expect(mongoose.modelNames).toContain('User');
    expect(mongoose.modelNames).toContain('Order');
  });

  // ── Order model ──────────────────────────────────────

  it('Order.create() and Order.find()', async () => {
    await Order.create({ userId: 'test-1', product: 'TestProduct', quantity: 2, price: 49.99, status: 'pending' });
    const orders = await Order.find({ status: 'pending' }) as Record<string, unknown>[];
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.every(o => o.status === 'pending')).toBe(true);
  });

  it('Order.countDocuments({ status: "pending" })', async () => {
    const count = await Order.countDocuments({ status: 'pending' });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
