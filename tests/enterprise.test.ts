// =====================================================
// JSDB Enterprise Features Test Suite
// Tests: CTEs, Window Functions, Triggers, Stored Procs
// =====================================================
import { describe, it, expect } from 'vitest';
import {
  parseCTE,
  parseWindowFunction,
  parseStoredProcedure,
  parseTrigger,
  parseView,
  parseTransaction,
  parseDDL,
  parseEnterprise,
} from '../src/ir/enterprise-parser.js';
import {
  compileCTE,
  compileWindowFunction,
  compileStoredProcedure,
  compileTrigger,
  compileView,
  compileTransaction,
  compileCreateTable,
  compileAlterTable,
  compileCreateIndex,
  checkFeatureSupport,
  compileEnterprise,
  type CompilerOptions,
} from '../src/ir/enterprise-compiler.js';

const mysqlOpts: CompilerOptions = { dialect: 'mysql', features: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: false, check: false, lateral: false } };
const pgOpts: CompilerOptions = { dialect: 'postgres', features: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: true, generated: true, identity: true, check: true, lateral: true } };
const sqliteOpts: CompilerOptions = { dialect: 'sqlite', features: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: true, check: false, lateral: false } };

describe('Enterprise SQL Parser', () => {
  // ---- CTE Tests ----
  describe('CTE Parsing', () => {
    it('parses simple CTE', () => {
      const ctes = parseCTE('WITH cte AS (SELECT * FROM orders) SELECT * FROM cte');
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('cte');
      expect(ctes[0].recursive).toBe(false);
      expect(ctes[0].query.sql).toContain('SELECT * FROM orders');
    });

    it('parses recursive CTE', () => {
      const ctes = parseCTE('WITH RECURSIVE emp_cte AS (SELECT id, name FROM employees WHERE id = 1 UNION ALL SELECT e.id, e.name FROM employees e JOIN emp_cte ec ON e.manager_id = ec.id) SELECT * FROM emp_cte');
      expect(ctes).toHaveLength(1);
      expect(ctes[0].recursive).toBe(true);
    });

    it('parses CTE with columns', () => {
      const ctes = parseCTE('WITH cte (col1, col2) AS (SELECT a, b FROM t) SELECT * FROM cte');
      expect(ctes).toHaveLength(1);
      expect(ctes[0].name).toBe('cte');
    });

    it('parses materialized CTE', () => {
      const ctes = parseCTE('WITH cte AS MATERIALIZED (SELECT * FROM t) SELECT * FROM cte');
      expect(ctes).toHaveLength(1);
      expect(ctes[0].materialized).toBe('MATERIALIZED');
    });
  });

  // ---- Window Function Tests ----
  describe('Window Function Parsing', () => {
    it('parses ROW_NUMBER', () => {
      const wf = parseWindowFunction('ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC)');
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('ROW_NUMBER');
      expect(wf!.partitionBy).toEqual(['department']);
      expect(wf!.orderBy).toEqual({ salary: -1 });
    });

    it('parses RANK', () => {
      const wf = parseWindowFunction('RANK() OVER (ORDER BY score DESC)');
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('RANK');
    });

    it('parses DENSE_RANK', () => {
      const wf = parseWindowFunction('DENSE_RANK() OVER (PARTITION BY region ORDER BY revenue DESC)');
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('DENSE_RANK');
      expect(wf!.partitionBy).toEqual(['region']);
    });

    it('parses SUM with window', () => {
      const wf = parseWindowFunction('SUM(amount) OVER (PARTITION BY customer_id ORDER BY order_date)');
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('SUM');
    });

    it('parses frame clause', () => {
      const wf = parseWindowFunction('SUM(sales) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)');
      expect(wf).not.toBeNull();
      expect(wf!.frame).toBeDefined();
      expect(wf!.frame!.type).toBe('ROWS');
    });
  });

  // ---- Stored Procedure Tests ----
  describe('Stored Procedure Parsing', () => {
    it('parses CALL statement', () => {
      const result = parseStoredProcedure('CALL update_inventory(1001, 50)');
      expect(result.type).toBe('call');
      expect(result.data).toEqual({ name: 'update_inventory', parameters: ['1001', '50'] });
    });

    it('parses CREATE PROCEDURE', () => {
      const result = parseStoredProcedure('CREATE PROCEDURE process_order(IN order_id INT, OUT status VARCHAR(20)) BEGIN UPDATE orders SET status = status WHERE id = order_id; END');
      expect(result.type).toBe('create');
      expect(result.data).toHaveProperty('name', 'process_order');
    });

    it('parses CREATE FUNCTION', () => {
      const result = parseStoredProcedure('CREATE FUNCTION calculate_tax(amount DECIMAL(10,2)) RETURNS DECIMAL(10,2) BEGIN RETURN amount * 0.1; END');
      expect(result.type).toBe('create');
    });
  });

  // ---- Trigger Tests ----
  describe('Trigger Parsing', () => {
    it('parses BEFORE INSERT trigger', () => {
      const trigger = parseTrigger('CREATE TRIGGER before_insert_orders BEFORE INSERT ON orders FOR EACH ROW BEGIN SET NEW.created_at = NOW(); END');
      expect(trigger.name).toBe('before_insert_orders');
      expect(trigger.timing).toBe('BEFORE');
      expect(trigger.events).toContain('INSERT');
      expect(trigger.table).toBe('orders');
      expect(trigger.forEachRow).toBe(true);
    });

    it('parses AFTER UPDATE trigger', () => {
      const trigger = parseTrigger('CREATE TRIGGER after_update_inventory AFTER UPDATE ON inventory FOR EACH ROW BEGIN INSERT INTO audit_log (table_name, operation) VALUES ("inventory", "UPDATE"); END');
      expect(trigger.timing).toBe('AFTER');
      expect(trigger.events).toContain('UPDATE');
    });

    it('parses trigger with WHEN clause', () => {
      const trigger = parseTrigger('CREATE TRIGGER validate_order BEFORE INSERT ON orders FOR EACH ROW WHEN (NEW.total > 0) BEGIN SET NEW.status = "pending"; END');
      expect(trigger.when).toContain('NEW.total > 0');
    });
  });

  // ---- View Tests ----
  describe('View Parsing', () => {
    it('parses CREATE VIEW', () => {
      const view = parseView('CREATE VIEW active_orders AS SELECT * FROM orders WHERE status = "active"');
      expect(view.name).toBe('active_orders');
      expect(view.sql).toContain('SELECT * FROM orders');
    });

    it('parses view with CHECK OPTION', () => {
      const view = parseView('CREATE VIEW premium_customers AS SELECT * FROM customers WHERE tier = "gold" WITH CASCADED CHECK OPTION');
      expect(view.checkOption).toBe('CASCADE');
    });
  });

  // ---- Transaction Tests ----
  describe('Transaction Parsing', () => {
    it('parses BEGIN', () => {
      const result = parseTransaction('BEGIN');
      expect(result.type).toBe('begin');
    });

    it('parses START TRANSACTION', () => {
      const result = parseTransaction('START TRANSACTION');
      expect(result.type).toBe('begin');
    });

    it('parses COMMIT', () => {
      const result = parseTransaction('COMMIT');
      expect(result.type).toBe('commit');
    });

    it('parses ROLLBACK', () => {
      const result = parseTransaction('ROLLBACK');
      expect(result.type).toBe('rollback');
    });

    it('parses SAVEPOINT', () => {
      const result = parseTransaction('SAVEPOINT sp1');
      expect(result.type).toBe('savepoint');
      expect(result.data).toEqual({ name: 'sp1' });
    });

    it('parses ROLLBACK TO SAVEPOINT', () => {
      const result = parseTransaction('ROLLBACK TO SAVEPOINT sp1');
      expect(result.type).toBe('rollback');
      expect(result.data).toEqual({ name: 'sp1' });
    });

    it('parses SET TRANSACTION ISOLATION LEVEL', () => {
      const result = parseTransaction('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      expect(result.type).toBe('set_isolation');
    });
  });

  // ---- DDL Tests ----
  describe('DDL Parsing', () => {
    it('parses CREATE TABLE', () => {
      const result = parseDDL('CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(255) NOT NULL, price DECIMAL(10,2))');
      expect(result.type).toBe('create_table');
      expect(result.data).toHaveProperty('name', 'products');
    });

    it('parses ALTER TABLE ADD COLUMN', () => {
      const result = parseDDL('ALTER TABLE products ADD COLUMN sku VARCHAR(50)');
      expect(result.type).toBe('alter_table');
      expect(result.data).toHaveProperty('type', 'ADD_COLUMN');
    });

    it('parses ALTER TABLE DROP COLUMN', () => {
      const result = parseDDL('ALTER TABLE products DROP COLUMN obsolete_field');
      expect(result.type).toBe('alter_table');
      expect(result.data).toHaveProperty('type', 'DROP_COLUMN');
    });

    it('parses CREATE INDEX', () => {
      const result = parseDDL('CREATE INDEX idx_products_name ON products (name)');
      expect(result.type).toBe('create_index');
      expect(result.data).toHaveProperty('name', 'idx_products_name');
    });

    it('parses DROP TABLE', () => {
      const result = parseDDL('DROP TABLE IF EXISTS temp_data');
      expect(result.type).toBe('drop_table');
    });
  });

  // ---- Enterprise Main Parser ----
  describe('Enterprise Main Parser', () => {
    it('detects CTE queries', () => {
      const result = parseEnterprise('WITH cte AS (SELECT * FROM t) SELECT * FROM cte');
      expect(result.type).toBe('query');
      expect(result.ctes).toHaveLength(1);
    });

    it('detects stored procedures', () => {
      const result = parseEnterprise('CALL my_proc(1, 2)');
      expect(result.type).toBe('procedure');
    });

    it('detects triggers', () => {
      const result = parseEnterprise('CREATE TRIGGER my_trigger BEFORE INSERT ON my_table FOR EACH ROW BEGIN SET NEW.created_at = NOW(); END');
      expect(result.type).toBe('trigger');
    });

    it('detects views', () => {
      const result = parseEnterprise('CREATE VIEW my_view AS SELECT * FROM t');
      expect(result.type).toBe('view');
    });

    it('detects transactions', () => {
      const result = parseEnterprise('BEGIN');
      expect(result.type).toBe('transaction');
    });

    it('detects DDL', () => {
      const result = parseEnterprise('CREATE TABLE t (id INT)');
      expect(result.type).toBe('ddl');
    });
  });
});

describe('Enterprise SQL Compiler', () => {
  // ---- CTE Compiler ----
  describe('CTE Compilation', () => {
    it('compiles simple CTE for MySQL', () => {
      const ctes = [{ name: 'cte', query: { type: 'select' as const, sql: 'SELECT * FROM orders' } }];
      const result = compileCTE(ctes, mysqlOpts);
      expect(result).toBe('WITH cte AS (SELECT * FROM orders)');
    });

    it('compiles recursive CTE for PostgreSQL', () => {
      const ctes = [{ name: 'emp_cte', recursive: true, query: { type: 'select' as const, sql: 'SELECT id FROM employees' } }];
      const result = compileCTE(ctes, pgOpts);
      expect(result).toContain('WITH RECURSIVE emp_cte AS');
    });

    it('compiles materialized CTE for PostgreSQL', () => {
      const ctes = [{ name: 'cte', materialized: 'MATERIALIZED' as const, query: { type: 'select' as const, sql: 'SELECT * FROM t' } }];
      const result = compileCTE(ctes, pgOpts);
      expect(result).toContain('MATERIALIZED');
    });
  });

  // ---- Window Function Compiler ----
  describe('Window Function Compilation', () => {
    it('compiles ROW_NUMBER for MySQL', () => {
      const wf = { fn: 'ROW_NUMBER' as const, partitionBy: ['dept'], orderBy: { salary: -1 } };
      const result = compileWindowFunction(wf, mysqlOpts);
      expect(result).toContain('ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC)');
    });

    it('compiles SUM with frame for PostgreSQL', () => {
      const wf = { fn: 'SUM' as const, args: ['amount'], partitionBy: ['customer_id'], orderBy: { date: 1 }, frame: { type: 'ROWS' as const, start: 'UNBOUNDED PRECEDING' as const, end: 'CURRENT ROW' as const } };
      const result = compileWindowFunction(wf, pgOpts);
      expect(result).toContain('SUM(amount) OVER');
      expect(result).toContain('PARTITION BY customer_id');
      expect(result).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
    });
  });

  // ---- Stored Procedure Compiler ----
  describe('Stored Procedure Compilation', () => {
    it('compiles for MySQL', () => {
      const proc = { name: 'process_order', parameters: [{ name: 'order_id', type: 'INT', direction: 'IN' as const }], body: 'UPDATE orders SET status = "processed" WHERE id = order_id;' };
      const result = compileStoredProcedure(proc, mysqlOpts);
      expect(result).toContain('CREATE PROCEDURE process_order(IN order_id INT)');
      expect(result).toContain('BEGIN');
      expect(result).toContain('END');
    });

    it('compiles for PostgreSQL', () => {
      const proc = { name: 'process_order', parameters: [{ name: 'p_order_id', type: 'INTEGER' }], body: 'UPDATE orders SET status = \'processed\' WHERE id = p_order_id;' };
      const result = compileStoredProcedure(proc, pgOpts);
      expect(result).toContain('CREATE OR REPLACE FUNCTION process_order(p_order_id INTEGER)');
      expect(result).toContain('$$ LANGUAGE plpgsql');
    });
  });

  // ---- Trigger Compiler ----
  describe('Trigger Compilation', () => {
    it('compiles BEFORE INSERT for MySQL', () => {
      const trigger = { name: 'audit_insert', timing: 'BEFORE' as const, events: ['INSERT' as const], table: 'orders', forEachRow: true, body: 'SET NEW.created_at = NOW();' };
      const result = compileTrigger(trigger, mysqlOpts);
      expect(result).toContain('CREATE TRIGGER audit_insert');
      expect(result).toContain('BEFORE INSERT ON orders');
      expect(result).toContain('FOR EACH ROW');
    });

    it('compiles for PostgreSQL (with function)', () => {
      const trigger = { name: 'audit_insert', timing: 'BEFORE' as const, events: ['INSERT' as const], table: 'orders', forEachRow: true, body: 'NEW.created_at = NOW();' };
      const result = compileTrigger(trigger, pgOpts);
      expect(result).toContain('CREATE OR REPLACE FUNCTION audit_insert_fn()');
      expect(result).toContain('CREATE TRIGGER audit_insert');
      expect(result).toContain('EXECUTE FUNCTION audit_insert_fn()');
    });
  });

  // ---- View Compiler ----
  describe('View Compilation', () => {
    it('compiles for MySQL', () => {
      const view = { name: 'active_orders', sql: 'SELECT * FROM orders WHERE status = "active"' };
      const result = compileView(view, mysqlOpts);
      expect(result).toContain('CREATE OR REPLACE VIEW active_orders AS');
    });

    it('compiles for PostgreSQL with security barrier', () => {
      const view = { name: 'user_data', sql: 'SELECT * FROM users', securityBarrier: true };
      const result = compileView(view, pgOpts);
      expect(result).toContain('CREATE OR REPLACE VIEW user_data AS');
      expect(result).toContain('security_barrier=true');
    });
  });

  // ---- Transaction Compiler ----
  describe('Transaction Compilation', () => {
    it('compiles BEGIN for MySQL', () => {
      const result = compileTransaction('begin', mysqlOpts);
      expect(result).toBe('START TRANSACTION');
    });

    it('compiles BEGIN with isolation for PostgreSQL', () => {
      const result = compileTransaction('begin', pgOpts, { level: 'SERIALIZABLE', readOnly: true });
      expect(result).toContain('START TRANSACTION');
      expect(result).toContain('ISOLATION LEVEL SERIALIZABLE');
      expect(result).toContain('READ ONLY');
    });

    it('compiles SAVEPOINT', () => {
      const result = compileTransaction('savepoint', mysqlOpts, undefined, 'sp1');
      expect(result).toBe('SAVEPOINT sp1');
    });

    it('compiles ROLLBACK TO SAVEPOINT', () => {
      const result = compileTransaction('rollback', mysqlOpts, undefined, 'sp1');
      expect(result).toBe('ROLLBACK TO SAVEPOINT sp1');
    });
  });

  // ---- DDL Compiler ----
  describe('DDL Compilation', () => {
    it('compiles CREATE TABLE for MySQL', () => {
      const columns = [
        { name: 'id', type: 'INT', autoIncrement: true, primaryKey: true },
        { name: 'name', type: 'VARCHAR', length: 255, nullable: false },
        { name: 'price', type: 'DECIMAL', precision: 10, scale: 2 },
      ];
      const result = compileCreateTable('products', columns, mysqlOpts);
      expect(result).toContain('CREATE TABLE products');
      expect(result).toContain('id INT');
      expect(result).toContain('AUTO_INCREMENT');
      expect(result).toContain('PRIMARY KEY');
      expect(result).toContain('name VARCHAR(255) NOT NULL');
    });

    it('compiles CREATE TABLE for PostgreSQL', () => {
      const columns = [
        { name: 'id', type: 'SERIAL', primaryKey: true },
        { name: 'name', type: 'VARCHAR', length: 255, nullable: false },
      ];
      const result = compileCreateTable('products', columns, pgOpts);
      expect(result).toContain('id SERIAL');
      expect(result).toContain('PRIMARY KEY');
    });

    it('compiles ALTER TABLE ADD COLUMN', () => {
      const op = { type: 'ADD_COLUMN' as const, table: 'products', column: { name: 'sku', type: 'VARCHAR', length: 50, nullable: false } };
      const result = compileAlterTable(op, mysqlOpts);
      expect(result).toBe('ALTER TABLE products ADD COLUMN sku VARCHAR(50) NOT NULL');
    });

    it('compiles CREATE INDEX', () => {
      const idx = { name: 'idx_name', table: 'products', columns: ['name'], unique: true };
      const result = compileCreateIndex(idx, mysqlOpts);
      expect(result).toBe('CREATE UNIQUE INDEX idx_name ON products (name)');
    });

    it('compiles CREATE INDEX with type for PostgreSQL', () => {
      const idx = { name: 'idx_gin', table: 'documents', columns: ['content'], type: 'GIN' as const };
      const result = compileCreateIndex(idx, pgOpts);
      expect(result).toContain('USING GIN');
    });
  });

  // ---- Feature Check ----
  describe('Feature Support', () => {
    it('MySQL supports CTEs', () => {
      expect(checkFeatureSupport('cte', mysqlOpts)).toBe(true);
    });

    it('MySQL does not support materialized CTEs', () => {
      expect(checkFeatureSupport('materializedCte', mysqlOpts)).toBe(false);
    });

    it('PostgreSQL supports materialized CTEs', () => {
      expect(checkFeatureSupport('materializedCte', pgOpts)).toBe(true);
    });

    it('SQLite does not support stored procedures', () => {
      expect(checkFeatureSupport('storedProcedures', sqliteOpts)).toBe(false);
    });
  });

  // ---- Enterprise Compile Main ----
  describe('Enterprise Main Compiler', () => {
    it('compiles CTE query', () => {
      const parseResult = {
        type: 'query' as const,
        ctes: [{ name: 'cte', query: { type: 'select' as const, sql: 'SELECT * FROM t' } }],
        windowFunctions: [],
        data: null,
        raw: 'WITH cte AS (SELECT * FROM t) SELECT * FROM cte',
      };
      const result = compileEnterprise(parseResult, mysqlOpts);
      expect(result).toContain('WITH cte AS (SELECT * FROM t)');
      expect(result).toContain('SELECT * FROM cte');
    });

    it('compiles stored procedure', () => {
      const parseResult = {
        type: 'procedure' as const,
        ctes: [],
        windowFunctions: [],
        data: { name: 'test_proc', parameters: [{ name: 'p1', type: 'INT' }], body: 'SELECT 1;' },
        raw: 'CREATE PROCEDURE test_proc(p1 INT) BEGIN SELECT 1; END',
      };
      const result = compileEnterprise(parseResult, mysqlOpts);
      expect(result).toContain('CREATE PROCEDURE test_proc');
    });
  });
});
