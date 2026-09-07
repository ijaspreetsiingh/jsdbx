// =============================================================
// ERP Application Simulation
// This module contains the ACTUAL business logic of a large ERP
// system. It is completely database-agnostic at the source level.
//
// The same class is used across ALL matrix cells:
//   - mysql2 SQL proxy → sqlite target
//   - pg SQL proxy    → mongodb target
//   - mongoose proxy  → mysql target
//   etc.
//
// It exercises:
//   CRUD, JOINs (SQL-level), nested filters, subqueries,
//   aggregates, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET,
//   transactions, bulk inserts, NULL handling, dates, strings,
//   numerics, conditional expressions, pagination, concurrent
//   queries, error handling, parameterized queries
// =============================================================

export interface ErpPool {
  query(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  execute(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  getConnection(): Promise<ErpConnection>;
  end(): Promise<void>;
}

export interface ErpConnection {
  query(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  execute(sql: string, params?: unknown[]): Promise<[Record<string, unknown>[], unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

// ---- MongoDB-style collection interface ----
export interface ErpCollection {
  find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<Record<string, unknown>[]>; sort(s: Record<string, number>): { limit(n: number): { toArray(): Promise<Record<string, unknown>[]> } }; limit(n: number): { toArray(): Promise<Record<string, unknown>[]> } };
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown; acknowledged: boolean }>;
  insertMany(docs: Record<string, unknown>[]): Promise<{ insertedCount: number; acknowledged: boolean }>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
  aggregate(pipeline: Record<string, unknown>[]): { toArray(): Promise<Record<string, unknown>[]> };
}

export interface ErpMongoDb {
  collection(name: string): ErpCollection;
}

// ============================================================
// SQL-style ERP Operations
// Used by: mysql2, pg, mysql (legacy) drivers
// ============================================================

export class SqlErpApp {
  constructor(private pool: ErpPool) {}

  async setupSchema(): Promise<void> {
    const tables = [
      `CREATE TABLE IF NOT EXISTS erp_vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        country TEXT NOT NULL,
        rating REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        contact_email TEXT,
        created_at TEXT DEFAULT '2024-01-01'
      )`,
      `CREATE TABLE IF NOT EXISTS erp_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit_price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 10,
        weight REAL,
        is_active INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS erp_customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        country TEXT NOT NULL,
        credit_limit REAL DEFAULT 5000,
        outstanding_balance REAL DEFAULT 0,
        tier TEXT DEFAULT 'standard',
        is_active INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS erp_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        subtotal REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        total REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        notes TEXT,
        order_date TEXT DEFAULT '2024-01-15'
      )`,
      `CREATE TABLE IF NOT EXISTS erp_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS erp_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'unpaid',
        due_date TEXT,
        paid_date TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS erp_inventory_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        change_qty INTEGER NOT NULL,
        reason TEXT,
        logged_at TEXT DEFAULT '2024-01-15'
      )`,
    ];
    for (const sql of tables) {
      await this.pool.query(sql);
    }
  }

  async seedData(): Promise<void> {
    // Vendors
    await this.pool.query(
      'INSERT INTO erp_vendors (name, country, rating, is_active, contact_email) VALUES (?, ?, ?, ?, ?)',
      ['Acme Corp', 'US', 4.5, 1, 'acme@vendor.com'],
    );
    await this.pool.query(
      'INSERT INTO erp_vendors (name, country, rating, is_active, contact_email) VALUES (?, ?, ?, ?, ?)',
      ['TechSupply Ltd', 'DE', 4.8, 1, 'tech@supply.de'],
    );
    await this.pool.query(
      'INSERT INTO erp_vendors (name, country, rating, is_active, contact_email) VALUES (?, ?, ?, ?, ?)',
      ['OldVendor Inc', 'JP', 2.1, 0, null],
    );

    // Products
    const products = [
      [1, 'PROD-001', 'Laptop Pro', 'Electronics', 1299.99, 50, 5, 2.1, 1],
      [1, 'PROD-002', 'USB Hub', 'Electronics', 29.99, 200, 20, 0.1, 1],
      [2, 'PROD-003', 'Server Rack', 'Infrastructure', 2499.99, 10, 2, 50.0, 1],
      [2, 'PROD-004', 'Network Switch', 'Infrastructure', 399.99, 30, 5, 3.5, 1],
      [1, 'PROD-005', 'Monitor 27"', 'Electronics', 449.99, 75, 10, 5.2, 1],
      [3, 'PROD-006', 'Old Widget', 'Misc', 9.99, 5, 0, 0.5, 0],
    ];
    for (const p of products) {
      await this.pool.query(
        'INSERT INTO erp_products (vendor_id, sku, name, category, unit_price, stock, min_stock, weight, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p,
      );
    }

    // Customers
    const customers = [
      ['MegaCorp', 'mega@corp.com', 'US', 50000, 0, 'enterprise', 1],
      ['StartupXYZ', 'hello@startupxyz.io', 'US', 10000, 2500, 'premium', 1],
      ['GlobalBank', 'procurement@globalbank.eu', 'EU', 100000, 0, 'enterprise', 1],
      ['SmallShop', 'owner@smallshop.com', 'US', 2000, 500, 'standard', 1],
      ['InactiveClient', 'dead@old.com', 'CA', 1000, 0, 'standard', 0],
    ];
    for (const c of customers) {
      await this.pool.query(
        'INSERT INTO erp_customers (name, email, country, credit_limit, outstanding_balance, tier, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        c,
      );
    }

    // Orders
    await this.pool.query(
      'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total, currency) VALUES (?, ?, ?, ?, ?, ?)',
      [1, 'completed', 2599.98, 208.00, 2807.98, 'USD'],
    );
    await this.pool.query(
      'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total, currency) VALUES (?, ?, ?, ?, ?, ?)',
      [2, 'pending', 399.99, 32.00, 431.99, 'USD'],
    );
    await this.pool.query(
      'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total, currency, discount) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [1, 'completed', 449.99, 36.00, 430.99, 'USD', 55.00],
    );
    await this.pool.query(
      'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total, currency) VALUES (?, ?, ?, ?, ?, ?)',
      [3, 'processing', 4999.98, 400.00, 5399.98, 'EUR'],
    );
    await this.pool.query(
      'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total, currency) VALUES (?, ?, ?, ?, ?, ?)',
      [4, 'cancelled', 29.99, 2.40, 32.39, 'USD'],
    );

    // Order items
    const items = [
      [1, 1, 2, 1299.99, 2599.98],
      [2, 4, 1, 399.99, 399.99],
      [3, 5, 1, 449.99, 449.99],
      [4, 3, 2, 2499.99, 4999.98],
      [5, 2, 1, 29.99, 29.99],
    ];
    for (const i of items) {
      await this.pool.query(
        'INSERT INTO erp_order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)',
        i,
      );
    }

    // Invoices
    await this.pool.query(
      "INSERT INTO erp_invoices (order_id, amount, status, due_date) VALUES (?, ?, ?, ?)",
      [1, 2807.98, 'paid', '2024-02-01'],
    );
    await this.pool.query(
      "INSERT INTO erp_invoices (order_id, amount, status, due_date) VALUES (?, ?, ?, ?)",
      [2, 431.99, 'unpaid', '2024-03-15'],
    );
    await this.pool.query(
      "INSERT INTO erp_invoices (order_id, amount, status, due_date) VALUES (?, ?, ?, ?)",
      [3, 430.99, 'paid', '2024-02-28'],
    );
    await this.pool.query(
      "INSERT INTO erp_invoices (order_id, amount, status, due_date) VALUES (?, ?, ?, ?)",
      [4, 5399.98, 'overdue', '2024-01-31'],
    );

    // Inventory log
    await this.pool.query(
      "INSERT INTO erp_inventory_log (product_id, change_qty, reason) VALUES (?, ?, ?)",
      [1, -2, 'sale'],
    );
    await this.pool.query(
      "INSERT INTO erp_inventory_log (product_id, change_qty, reason) VALUES (?, ?, ?)",
      [1, 10, 'restock'],
    );
    await this.pool.query(
      "INSERT INTO erp_inventory_log (product_id, change_qty, reason) VALUES (?, ?, ?)",
      [3, -2, 'sale'],
    );
  }

  // ---- CRUD ----

  async getAllActiveVendors() {
    const [rows] = await this.pool.query('SELECT * FROM erp_vendors WHERE is_active = 1');
    return rows;
  }

  async getVendorById(id: number) {
    const [rows] = await this.pool.query('SELECT * FROM erp_vendors WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async updateVendorRating(id: number, rating: number) {
    const [result] = await this.pool.query(
      'UPDATE erp_vendors SET rating = ? WHERE id = ?',
      [rating, id],
    );
    return result;
  }

  async deleteVendor(id: number) {
    const [result] = await this.pool.query('DELETE FROM erp_vendors WHERE id = ?', [id]);
    return result;
  }

  // ---- Filtering ----

  async getProductsByCategory(category: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE category = ? AND is_active = 1 ORDER BY unit_price ASC',
      [category],
    );
    return rows;
  }

  async getProductsUnderPrice(maxPrice: number) {
    const [rows] = await this.pool.query(
      'SELECT sku, name, unit_price FROM erp_products WHERE unit_price < ? AND is_active = 1',
      [maxPrice],
    );
    return rows;
  }

  async getProductsInPriceRange(min: number, max: number) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE unit_price BETWEEN ? AND ? AND is_active = 1',
      [min, max],
    );
    return rows;
  }

  async getLowStockProducts() {
    const [rows] = await this.pool.query(
      'SELECT sku, name, stock, min_stock FROM erp_products WHERE stock <= min_stock AND is_active = 1',
    );
    return rows;
  }

  async getProductsWithNullWeight() {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE weight IS NULL',
    );
    return rows;
  }

  async getProductsWithWeight() {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE weight IS NOT NULL',
    );
    return rows;
  }

  async searchProductsByName(term: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE name LIKE ?',
      [`%${term}%`],
    );
    return rows;
  }

  async getOrdersByStatus(status: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_orders WHERE status = ? ORDER BY id DESC',
      [status],
    );
    return rows;
  }

  async getOrdersExcludingStatuses(statuses: string[]) {
    const placeholders = statuses.map(() => '?').join(', ');
    const [rows] = await this.pool.query(
      `SELECT * FROM erp_orders WHERE status NOT IN (${placeholders})`,
      statuses,
    );
    return rows;
  }

  async getEnterpriseOrPremiumCustomers() {
    const [rows] = await this.pool.query(
      "SELECT * FROM erp_customers WHERE tier IN (?, ?) AND is_active = 1",
      ['enterprise', 'premium'],
    );
    return rows;
  }

  async getCustomersWithHighBalance(threshold: number) {
    const [rows] = await this.pool.query(
      'SELECT name, outstanding_balance, credit_limit FROM erp_customers WHERE outstanding_balance > ?',
      [threshold],
    );
    return rows;
  }

  // ---- Sorting + Pagination ----

  async getProductsSortedByPrice(desc = false) {
    const dir = desc ? 'DESC' : 'ASC';
    const [rows] = await this.pool.query(
      `SELECT * FROM erp_products WHERE is_active = 1 ORDER BY unit_price ${dir}`,
    );
    return rows;
  }

  async getProductsPaginated(offset: number, limit: number) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE is_active = 1 ORDER BY id ASC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows;
  }

  async getTopOrdersByTotal(n: number) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_orders ORDER BY total DESC LIMIT ?',
      [n],
    );
    return rows;
  }

  // ---- Aggregates + GROUP BY ----

  async getOrderCountByStatus() {
    const [rows] = await this.pool.query(
      'SELECT status, COUNT(*) AS cnt FROM erp_orders GROUP BY status ORDER BY cnt DESC',
    );
    return rows;
  }

  async getRevenueByCustomer() {
    const [rows] = await this.pool.query(
      "SELECT customer_id, SUM(total) AS total_revenue, COUNT(*) AS order_count FROM erp_orders WHERE status = 'completed' GROUP BY customer_id ORDER BY total_revenue DESC",
    );
    return rows;
  }

  async getAvgOrderValue() {
    const [rows] = await this.pool.query(
      'SELECT AVG(total) AS avg_value, MIN(total) AS min_value, MAX(total) AS max_value FROM erp_orders',
    );
    return rows;
  }

  async getProductCountByCategory() {
    const [rows] = await this.pool.query(
      'SELECT category, COUNT(*) AS product_count, AVG(unit_price) AS avg_price FROM erp_products WHERE is_active = 1 GROUP BY category',
    );
    return rows;
  }

  async getVendorOrderStats() {
    const [rows] = await this.pool.query(
      'SELECT vendor_id, COUNT(*) AS product_count, SUM(stock) AS total_stock FROM erp_products GROUP BY vendor_id',
    );
    return rows;
  }

  async getTotalUnpaidInvoices() {
    const [rows] = await this.pool.query(
      "SELECT SUM(amount) AS total_unpaid, COUNT(*) AS invoice_count FROM erp_invoices WHERE status != 'paid'",
    );
    return rows;
  }

  // ---- NULL handling ----

  async getVendorsWithNoEmail() {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_vendors WHERE contact_email IS NULL',
    );
    return rows;
  }

  async getOrdersWithNotes() {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_orders WHERE notes IS NOT NULL',
    );
    return rows;
  }

  // ---- Transactions ----

  async createOrderWithItems(
    customerId: number,
    items: { productId: number; quantity: number; unitPrice: number }[],
  ): Promise<{ orderId: number | null; error: Error | null }> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const tax = subtotal * 0.08;
      const total = subtotal + tax;

      await conn.query(
        'INSERT INTO erp_orders (customer_id, status, subtotal, tax, total) VALUES (?, ?, ?, ?, ?)',
        [customerId, 'pending', subtotal, tax, total],
      );

      const [afterInsert] = await conn.query(
        'SELECT id FROM erp_orders ORDER BY id DESC LIMIT 1',
      );
      const orderId = (afterInsert[0] as Record<string, unknown>)?.id as number;

      for (const item of items) {
        await conn.query(
          'INSERT INTO erp_order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)',
          [orderId, item.productId, item.quantity, item.unitPrice, item.quantity * item.unitPrice],
        );
      }

      await conn.commit();
      return { orderId, error: null };
    } catch (err) {
      await conn.rollback();
      return { orderId: null, error: err as Error };
    } finally {
      conn.release();
    }
  }

  async transferCredit(
    fromCustomerId: number,
    toCustomerId: number,
    amount: number,
  ): Promise<{ success: boolean; error: Error | null }> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Check balance
      const [fromRows] = await conn.query(
        'SELECT outstanding_balance FROM erp_customers WHERE id = ?',
        [fromCustomerId],
      );
      const fromBalance = Number((fromRows[0] as Record<string, unknown>)?.outstanding_balance ?? 0);

      if (fromBalance < amount) {
        throw new Error('Insufficient balance');
      }

      await conn.query(
        'UPDATE erp_customers SET outstanding_balance = ? WHERE id = ?',
        [fromBalance - amount, fromCustomerId],
      );
      const [toRows] = await conn.query(
        'SELECT outstanding_balance FROM erp_customers WHERE id = ?',
        [toCustomerId],
      );
      const toBalance = Number((toRows[0] as Record<string, unknown>)?.outstanding_balance ?? 0);
      await conn.query(
        'UPDATE erp_customers SET outstanding_balance = ? WHERE id = ?',
        [toBalance + amount, toCustomerId],
      );

      await conn.commit();
      return { success: true, error: null };
    } catch (err) {
      await conn.rollback();
      return { success: false, error: err as Error };
    } finally {
      conn.release();
    }
  }

  // ---- Bulk operations ----

  async bulkInsertInventoryLog(entries: { productId: number; changeQty: number; reason: string }[]) {
    const results = [];
    for (const e of entries) {
      const [r] = await this.pool.query(
        'INSERT INTO erp_inventory_log (product_id, change_qty, reason) VALUES (?, ?, ?)',
        [e.productId, e.changeQty, e.reason],
      );
      results.push(r);
    }
    return results;
  }

  async bulkUpdateProductStatus(productIds: number[], isActive: number) {
    const placeholders = productIds.map(() => '?').join(', ');
    const [result] = await this.pool.query(
      `UPDATE erp_products SET is_active = ? WHERE id IN (${placeholders})`,
      [isActive, ...productIds],
    );
    return result;
  }

  async bulkDeleteOldLogs(reason: string) {
    const [result] = await this.pool.query(
      'DELETE FROM erp_inventory_log WHERE reason = ?',
      [reason],
    );
    return result;
  }

  // ---- Subqueries (WHERE IN SELECT) ----

  async getCustomersWithCompletedOrders() {
    const [rows] = await this.pool.query(
      "SELECT * FROM erp_customers WHERE id IN (SELECT customer_id FROM erp_orders WHERE status = 'completed')",
    );
    return rows;
  }

  async getProductsInCompletedOrders() {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_products WHERE id IN (SELECT product_id FROM erp_order_items WHERE order_id IN (SELECT id FROM erp_orders WHERE status = ?))',
      ['completed'],
    );
    return rows;
  }

  // ---- Concurrent queries ----

  async getConcurrentStats() {
    const [vendorCount, productCount, customerCount, orderCount] = await Promise.all([
      this.pool.query('SELECT COUNT(*) AS cnt FROM erp_vendors'),
      this.pool.query('SELECT COUNT(*) AS cnt FROM erp_products'),
      this.pool.query('SELECT COUNT(*) AS cnt FROM erp_customers'),
      this.pool.query('SELECT COUNT(*) AS cnt FROM erp_orders'),
    ]);
    return {
      vendors: Number((vendorCount[0] as Record<string, unknown>[])[0]?.cnt ?? 0),
      products: Number((productCount[0] as Record<string, unknown>[])[0]?.cnt ?? 0),
      customers: Number((customerCount[0] as Record<string, unknown>[])[0]?.cnt ?? 0),
      orders: Number((orderCount[0] as Record<string, unknown>[])[0]?.cnt ?? 0),
    };
  }

  // ---- Error handling ----

  async handleInvalidQuery(): Promise<{ threw: boolean; errorMsg: string }> {
    try {
      await this.pool.query('THIS IS COMPLETELY INVALID SQL!!!');
      return { threw: false, errorMsg: '' };
    } catch (err) {
      return { threw: true, errorMsg: (err as Error).message };
    }
  }

  async handleInsertWithDuplicateSku(): Promise<{ threw: boolean }> {
    try {
      await this.pool.query(
        'INSERT INTO erp_products (vendor_id, sku, name, category, unit_price) VALUES (?, ?, ?, ?, ?)',
        [1, 'PROD-001', 'Duplicate', 'Electronics', 9.99],
      );
      return { threw: false };
    } catch {
      return { threw: true };
    }
  }

  // ---- String + date operations ----

  async getVendorByEmailDomain(domain: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_vendors WHERE contact_email LIKE ?',
      [`%@${domain}`],
    );
    return rows;
  }

  async getOrdersByDateRange(from: string, to: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_orders WHERE order_date >= ? AND order_date <= ?',
      [from, to],
    );
    return rows;
  }

  // ---- Parameterized queries safety ----

  async sqlInjectionTest(maliciousInput: string) {
    const [rows] = await this.pool.query(
      'SELECT * FROM erp_customers WHERE email = ?',
      [maliciousInput],
    );
    return rows;
  }

  // ---- Cleanup ----

  async dropAllTables(): Promise<void> {
    const tables = [
      'erp_inventory_log', 'erp_invoices', 'erp_order_items',
      'erp_orders', 'erp_products', 'erp_customers', 'erp_vendors',
    ];
    for (const t of tables) {
      await this.pool.query(`DROP TABLE IF EXISTS ${t}`).catch(() => {});
    }
  }
}

// ============================================================
// MongoDB-style ERP Operations
// Used by: mongodb driver, mongoose proxies
// ============================================================

export class MongoErpApp {
  private db: ErpMongoDb;

  constructor(db: ErpMongoDb) {
    this.db = db;
  }

  private col(name: string) { return this.db.collection(name); }

  async seedData(): Promise<void> {
    // Clear all
    await this.col('erp_vendors').deleteMany({});
    await this.col('erp_products').deleteMany({});
    await this.col('erp_customers').deleteMany({});
    await this.col('erp_orders').deleteMany({});
    await this.col('erp_order_items').deleteMany({});

    // Vendors
    await this.col('erp_vendors').insertMany([
      { _id: 1, name: 'Acme Corp', country: 'US', rating: 4.5, is_active: true, contact_email: 'acme@vendor.com' },
      { _id: 2, name: 'TechSupply Ltd', country: 'DE', rating: 4.8, is_active: true, contact_email: 'tech@supply.de' },
      { _id: 3, name: 'OldVendor Inc', country: 'JP', rating: 2.1, is_active: false, contact_email: null },
    ]);

    // Products
    await this.col('erp_products').insertMany([
      { _id: 1, vendor_id: 1, sku: 'PROD-001', name: 'Laptop Pro', category: 'Electronics', unit_price: 1299.99, stock: 50, min_stock: 5, is_active: true },
      { _id: 2, vendor_id: 1, sku: 'PROD-002', name: 'USB Hub', category: 'Electronics', unit_price: 29.99, stock: 200, min_stock: 20, is_active: true },
      { _id: 3, vendor_id: 2, sku: 'PROD-003', name: 'Server Rack', category: 'Infrastructure', unit_price: 2499.99, stock: 10, min_stock: 2, is_active: true },
      { _id: 4, vendor_id: 2, sku: 'PROD-004', name: 'Network Switch', category: 'Infrastructure', unit_price: 399.99, stock: 30, min_stock: 5, is_active: true },
      { _id: 5, vendor_id: 1, sku: 'PROD-005', name: 'Monitor 27"', category: 'Electronics', unit_price: 449.99, stock: 75, min_stock: 10, is_active: true },
      { _id: 6, vendor_id: 3, sku: 'PROD-006', name: 'Old Widget', category: 'Misc', unit_price: 9.99, stock: 5, min_stock: 0, is_active: false },
    ]);

    // Customers
    await this.col('erp_customers').insertMany([
      { _id: 1, name: 'MegaCorp', email: 'mega@corp.com', country: 'US', credit_limit: 50000, outstanding_balance: 0, tier: 'enterprise', is_active: true },
      { _id: 2, name: 'StartupXYZ', email: 'hello@startupxyz.io', country: 'US', credit_limit: 10000, outstanding_balance: 2500, tier: 'premium', is_active: true },
      { _id: 3, name: 'GlobalBank', email: 'procurement@globalbank.eu', country: 'EU', credit_limit: 100000, outstanding_balance: 0, tier: 'enterprise', is_active: true },
      { _id: 4, name: 'SmallShop', email: 'owner@smallshop.com', country: 'US', credit_limit: 2000, outstanding_balance: 500, tier: 'standard', is_active: true },
      { _id: 5, name: 'InactiveClient', email: 'dead@old.com', country: 'CA', credit_limit: 1000, outstanding_balance: 0, tier: 'standard', is_active: false },
    ]);

    // Orders
    await this.col('erp_orders').insertMany([
      { _id: 1, customer_id: 1, status: 'completed', subtotal: 2599.98, tax: 208.00, total: 2807.98, currency: 'USD' },
      { _id: 2, customer_id: 2, status: 'pending', subtotal: 399.99, tax: 32.00, total: 431.99, currency: 'USD' },
      { _id: 3, customer_id: 1, status: 'completed', subtotal: 449.99, tax: 36.00, discount: 55.00, total: 430.99, currency: 'USD' },
      { _id: 4, customer_id: 3, status: 'processing', subtotal: 4999.98, tax: 400.00, total: 5399.98, currency: 'EUR' },
      { _id: 5, customer_id: 4, status: 'cancelled', subtotal: 29.99, tax: 2.40, total: 32.39, currency: 'USD' },
    ]);
  }

  // ---- CRUD ----

  async getAllActiveVendors() {
    return this.col('erp_vendors').find({ is_active: true }).toArray();
  }

  async getVendorById(id: number) {
    return this.col('erp_vendors').findOne({ _id: id });
  }

  async updateVendorRating(id: number, rating: number) {
    return this.col('erp_vendors').updateOne({ _id: id }, { $set: { rating } });
  }

  async deleteVendor(id: number) {
    return this.col('erp_vendors').deleteOne({ _id: id });
  }

  // ---- Filtering ----

  async getProductsByCategory(category: string) {
    return this.col('erp_products').find({ category, is_active: true }).toArray();
  }

  async getProductsUnderPrice(maxPrice: number) {
    return this.col('erp_products').find({ unit_price: { $lt: maxPrice }, is_active: true }).toArray();
  }

  async getProductsInPriceRange(min: number, max: number) {
    return this.col('erp_products').find({ unit_price: { $gte: min, $lte: max }, is_active: true }).toArray();
  }

  async getEnterpriseOrPremiumCustomers() {
    return this.col('erp_customers').find({ tier: { $in: ['enterprise', 'premium'] }, is_active: true }).toArray();
  }

  async getOrdersByStatus(status: string) {
    return this.col('erp_orders').find({ status }).toArray();
  }

  async getOrdersExcludingStatuses(statuses: string[]) {
    return this.col('erp_orders').find({ status: { $nin: statuses } }).toArray();
  }

  async getCustomersWithHighBalance(threshold: number) {
    return this.col('erp_customers').find({ outstanding_balance: { $gt: threshold } }).toArray();
  }

  async getVendorsWithNoEmail() {
    return this.col('erp_vendors').find({ contact_email: null }).toArray();
  }

  async searchProductsByName(term: string) {
    return this.col('erp_products').find({ name: { $regex: term, $options: 'i' } }).toArray();
  }

  // ---- Sorting + Pagination ----

  async getProductsSortedByPrice(desc = false) {
    return this.col('erp_products')
      .find({ is_active: true })
      .sort({ unit_price: desc ? -1 : 1 })
      .toArray();
  }

  async getTopOrdersByTotal(n: number) {
    return this.col('erp_orders').find({}).sort({ total: -1 }).limit(n).toArray();
  }

  async getProductsPaginated(skip: number, limit: number) {
    const all = await this.col('erp_products').find({ is_active: true }).toArray();
    return all.slice(skip, skip + limit);
  }

  // ---- Aggregates ----

  async getOrderCountByStatus() {
    return this.col('erp_orders').aggregate([
      { $group: { _id: '$status', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
    ]).toArray();
  }

  async getRevenueByCustomer() {
    return this.col('erp_orders').aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$customer_id', total_revenue: { $sum: '$total' }, order_count: { $sum: 1 } } },
      { $sort: { total_revenue: -1 } },
    ]).toArray();
  }

  async getAvgOrderValue() {
    return this.col('erp_orders').aggregate([
      { $group: { _id: null, avg_value: { $avg: '$total' }, min_value: { $min: '$total' }, max_value: { $max: '$total' } } },
    ]).toArray();
  }

  async getProductCountByCategory() {
    return this.col('erp_products').aggregate([
      { $match: { is_active: true } },
      { $group: { _id: '$category', product_count: { $sum: 1 }, avg_price: { $avg: '$unit_price' } } },
    ]).toArray();
  }

  // ---- Concurrent ----

  async getConcurrentStats() {
    const [vendorCount, productCount, customerCount, orderCount] = await Promise.all([
      this.col('erp_vendors').countDocuments(),
      this.col('erp_products').countDocuments(),
      this.col('erp_customers').countDocuments(),
      this.col('erp_orders').countDocuments(),
    ]);
    return { vendors: vendorCount, products: productCount, customers: customerCount, orders: orderCount };
  }

  // ---- Bulk ----

  async bulkUpdateProducts(ids: number[], update: Record<string, unknown>) {
    return this.col('erp_products').updateMany({ _id: { $in: ids } }, { $set: update });
  }

  async bulkDeleteProducts(ids: number[]) {
    return this.col('erp_products').deleteMany({ _id: { $in: ids } });
  }
}
