// =====================================================
// JSDB Real-World ERP/CRM Integration Test
// Tests actual production queries used in enterprise apps
// =====================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  compileEnterprise,
  type CompilerOptions,
} from '../src/ir/enterprise-compiler.js';

const mysqlOpts: CompilerOptions = { dialect: 'mysql', features: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: false, check: false, lateral: false } };
const pgOpts: CompilerOptions = { dialect: 'postgres', features: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: true, generated: true, identity: true, check: true, lateral: true } };

describe('Real-World ERP/CRM Queries', () => {
  // ============================================================
  // 1. FINANCIAL QUERIES (Accounting, Invoicing, Reports)
  // ============================================================
  describe('Financial Queries', () => {
    it('running balance calculation (CTE + Window)', () => {
      const sql = 'WITH running_balance AS (SELECT id, amount, SUM(amount) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as balance FROM transactions WHERE account_id = 100) SELECT * FROM running_balance WHERE balance > 0';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
      expect(result.ctes).toHaveLength(1);
      expect(result.ctes[0].name).toBe('running_balance');
    });

    it('monthly revenue summary (Window Function)', () => {
      const sql = 'SELECT DATE_TRUNC(\'month\', order_date) as month, SUM(total) as revenue, LAG(SUM(total)) OVER (ORDER BY DATE_TRUNC(\'month\', order_date)) as prev_month FROM orders WHERE status = \'completed\' GROUP BY DATE_TRUNC(\'month\', order_date)';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('LAG');
    });

    it('profit & loss statement (CTE + Aggregation)', () => {
      const sql = 'WITH revenue AS (SELECT SUM(amount) as total FROM invoices WHERE type = \'income\'), expenses AS (SELECT SUM(amount) as total FROM invoices WHERE type = \'expense\') SELECT r.total as revenue, e.total as expenses, r.total - e.total as profit FROM revenue r, expenses e';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });

    it('year-over-year comparison', () => {
      const sql = 'SELECT product_name, year, revenue, LAG(revenue) OVER (PARTITION BY product_name ORDER BY year) as prev_year, ROUND((revenue - LAG(revenue) OVER (PARTITION BY product_name ORDER BY year)) / LAG(revenue) OVER (PARTITION BY product_name ORDER BY year) * 100, 2) as growth_pct FROM annual_sales';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('LAG');
      expect(wf!.partitionBy).toEqual(['product_name']);
    });

    it('tax calculation with CASE WHEN', () => {
      const sql = 'SELECT id, amount, CASE WHEN amount < 1000 THEN amount * 0.05 WHEN amount < 5000 THEN amount * 0.10 WHEN amount < 10000 THEN amount * 0.15 ELSE amount * 0.20 END as tax FROM invoices';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
    });
  });

  // ============================================================
  // 2. EMPLOYEE/HR QUERIES (Hierarchy, Performance, Reports)
  // ============================================================
  describe('HR/Employee Queries', () => {
    it('employee hierarchy (Recursive CTE)', () => {
      const sql = 'WITH RECURSIVE emp_tree AS (SELECT id, name, manager_id, 1 as level FROM employees WHERE id = 1 UNION ALL SELECT e.id, e.name, e.manager_id, et.level + 1 FROM employees e JOIN emp_tree et ON e.manager_id = et.id) SELECT * FROM emp_tree ORDER BY level';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
      expect(result.ctes[0].recursive).toBe(true);
    });

    it('department salary ranking', () => {
      const sql = 'SELECT e.name, d.department_name, e.salary, RANK() OVER (PARTITION BY d.department_name ORDER BY e.salary DESC) as salary_rank, DENSE_RANK() OVER (PARTITION BY d.department_name ORDER BY e.salary DESC) as dense_rank FROM employees e JOIN departments d ON e.dept_id = d.id';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('RANK');
    });

    it('attendance summary (Window + Group)', () => {
      const sql = 'SELECT employee_id, DATE(attendance_date) as day, COUNT(*) OVER (PARTITION BY employee_id ORDER BY DATE(attendance_date) ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as consecutive_days FROM attendance WHERE status = \'present\'';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.frame).toBeDefined();
    });

    it('leave balance calculation', () => {
      const sql = 'WITH leave_used AS (SELECT employee_id, SUM(days) as used FROM leave_requests WHERE status = \'approved\' AND YEAR(start_date) = 2026 GROUP BY employee_id) SELECT e.id, e.name, e.annual_leave - COALESCE(lu.used, 0) as remaining FROM employees e LEFT JOIN leave_used lu ON e.id = lu.employee_id';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
    });
  });

  // ============================================================
  // 3. INVENTORY/WAREHOUSE QUERIES
  // ============================================================
  describe('Inventory Queries', () => {
    it('stock level with reorder alert', () => {
      const sql = 'WITH stock_summary AS (SELECT p.id, p.name, p.reorder_level, COALESCE(SUM(i.quantity), 0) as current_stock FROM products p LEFT JOIN inventory i ON p.id = i.product_id GROUP BY p.id, p.name, p.reorder_level) SELECT * FROM stock_summary WHERE current_stock <= reorder_level ORDER BY current_stock ASC';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
    });

    it('warehouse capacity utilization', () => {
      const sql = 'SELECT w.name, w.capacity, SUM(i.quantity) as used, ROUND(SUM(i.quantity) * 100.0 / w.capacity, 2) as utilization_pct, NTILE(4) OVER (ORDER BY SUM(i.quantity) * 100.0 / w.capacity) as capacity_quartile FROM warehouses w JOIN inventory i ON w.id = i.warehouse_id GROUP BY w.id, w.name, w.capacity';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('NTILE');
    });

    it('inventory movement audit trail', () => {
      const sql = 'SELECT im.*, p.name as product_name, w.name as warehouse_name, im.quantity_change, im.movement_type, im.created_at, LAG(im.quantity_change) OVER (PARTITION BY im.product_id ORDER BY im.created_at) as prev_change FROM inventory_movements im JOIN products p ON im.product_id = p.id JOIN warehouses w ON im.warehouse_id = w.id WHERE im.created_at >= \'2026-01-01\'';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
      expect(wf!.fn).toBe('LAG');
    });
  });

  // ============================================================
  // 4. CRM/SALES QUERIES
  // ============================================================
  describe('CRM/Sales Queries', () => {
    it('sales pipeline funnel', () => {
      const sql = 'WITH pipeline AS (SELECT stage, COUNT(*) as deals, SUM(value) as total_value FROM opportunities WHERE deleted_at IS NULL GROUP BY stage) SELECT stage, deals, total_value, ROUND(deals * 100.0 / SUM(deals) OVER (), 2) as deal_pct, ROUND(total_value * 100.0 / SUM(total_value) OVER (), 2) as value_pct FROM pipeline ORDER BY deals DESC';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
    });

    it('customer lifetime value (CLV)', () => {
      const sql = 'WITH customer_stats AS (SELECT customer_id, COUNT(*) as orders, SUM(total) as total_spent, AVG(total) as avg_order, MIN(order_date) as first_order, MAX(order_date) as last_order FROM orders WHERE status = \'completed\' GROUP BY customer_id) SELECT c.id, c.name, cs.orders, cs.total_spent, cs.avg_order, DATEDIFF(cs.last_order, cs.first_order) as customer_days, cs.total_spent / NULLIF(DATEDIFF(cs.last_order, cs.first_order), 0) as daily_value FROM customers c JOIN customer_stats cs ON c.id = cs.customer_id';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
    });

    it('sales rep performance ranking', () => {
      const sql = 'SELECT sr.name, sr.region, COUNT(o.id) as deals, SUM(o.total) as revenue, AVG(o.total) as avg_deal_size, RANK() OVER (PARTITION BY sr.region ORDER BY SUM(o.total) DESC) as regional_rank, SUM(o.total) / SUM(COUNT(o.id)) OVER (PARTITION BY sr.region) as region_avg FROM sales_reps sr JOIN orders o ON sr.id = o.sales_rep_id WHERE o.status = \'completed\' GROUP BY sr.id, sr.name, sr.region';
      const wf = parseWindowFunction(sql);
      expect(wf).not.toBeNull();
    });

    it('customer churn prediction', () => {
      const sql = 'WITH last_orders AS (SELECT customer_id, MAX(order_date) as last_order, COUNT(*) as total_orders FROM orders GROUP BY customer_id), customer_activity AS (SELECT c.id, c.name, c.email, lo.last_order, lo.total_orders, DATEDIFF(NOW(), lo.last_order) as days_inactive FROM customers c LEFT JOIN last_orders lo ON c.id = lo.customer_id) SELECT *, CASE WHEN days_inactive > 90 THEN \'high_risk\' WHEN days_inactive > 60 THEN \'medium_risk\' WHEN days_inactive > 30 THEN \'low_risk\' ELSE \'active\' END as churn_risk FROM customer_activity ORDER BY days_inactive DESC';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });
  });

  // ============================================================
  // 5. ORDER PROCESSING QUERIES
  // ============================================================
  describe('Order Processing Queries', () => {
    it('order fulfillment tracking', () => {
      const sql = 'SELECT o.id, o.order_date, c.name as customer_name, o.status, o.total, p.product_name, op.quantity, op.price, s.name as supplier_name, CASE o.status WHEN \'pending\' THEN 1 WHEN \'processing\' THEN 2 WHEN \'shipped\' THEN 3 WHEN \'delivered\' THEN 4 ELSE 5 END as status_order FROM orders o JOIN customers c ON o.customer_id = c.id JOIN order_products op ON o.id = op.order_id JOIN products p ON op.product_id = p.id LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE o.order_date >= \'2026-01-01\' ORDER BY status_order, o.order_date DESC';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
    });

    it('bulk order processing trigger', () => {
      const sql = 'CREATE TRIGGER trg_update_inventory AFTER INSERT ON order_products FOR EACH ROW BEGIN UPDATE inventory SET quantity = quantity - NEW.quantity WHERE product_id = NEW.product_id AND warehouse_id = (SELECT warehouse_id FROM orders WHERE id = NEW.order_id); INSERT INTO inventory_log (product_id, quantity_change, order_id, created_at) VALUES (NEW.product_id, -NEW.quantity, NEW.order_id, NOW()); END';
      const trigger = parseTrigger(sql);
      expect(trigger.name).toBe('trg_update_inventory');
      expect(trigger.timing).toBe('AFTER');
      expect(trigger.events).toContain('INSERT');
      expect(trigger.forEachRow).toBe(true);
    });

    it('order total calculation view', () => {
      const sql = 'CREATE VIEW v_order_summary AS SELECT o.id, o.order_date, c.name as customer_name, COUNT(op.id) as item_count, SUM(op.quantity) as total_items, SUM(op.quantity * op.price) as order_total, o.payment_status, o.shipping_status FROM orders o JOIN customers c ON o.customer_id = c.id JOIN order_products op ON o.id = op.order_id GROUP BY o.id, o.order_date, c.name, o.payment_status, o.shipping_status';
      const view = parseView(sql);
      expect(view.name).toBe('v_order_summary');
      expect(view.sql).toContain('SELECT o.id');
    });
  });

  // ============================================================
  // 6. COMPLEX REPORTING QUERIES
  // ============================================================
  describe('Complex Reporting Queries', () => {
    it('monthly sales report with comparison', () => {
      const sql = 'WITH monthly AS (SELECT DATE_FORMAT(order_date, \'%Y-%m\') as month, COUNT(*) as orders, SUM(total) as revenue FROM orders WHERE status = \'completed\' GROUP BY DATE_FORMAT(order_date, \'%Y-%m\')) SELECT month, orders, revenue, LAG(revenue) OVER (ORDER BY month) as prev_month_revenue, ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month) * 100, 2) as growth_pct, SUM(revenue) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as cumulative_revenue FROM monthly ORDER BY month';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(1);
    });

    it('top products by category', () => {
      const sql = 'WITH product_sales AS (SELECT p.id, p.name, c.name as category, SUM(op.quantity) as units_sold, SUM(op.quantity * op.price) as revenue FROM products p JOIN order_products op ON p.id = op.product_id JOIN categories c ON p.category_id = c.id GROUP BY p.id, p.name, c.name), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY revenue DESC) as rank_in_category FROM product_sales) SELECT * FROM ranked WHERE rank_in_category <= 10';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });

    it('financial quarter report', () => {
      const sql = 'SELECT CASE WHEN MONTH(order_date) IN (1,2,3) THEN \'Q1\' WHEN MONTH(order_date) IN (4,5,6) THEN \'Q2\' WHEN MONTH(order_date) IN (7,8,9) THEN \'Q3\' ELSE \'Q4\' END as quarter, COUNT(*) as total_orders, SUM(total) as revenue, AVG(total) as avg_order_value, MIN(total) as min_order, MAX(total) as max_order FROM orders WHERE YEAR(order_date) = 2026 AND status = \'completed\' GROUP BY quarter ORDER BY quarter';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
    });

    it('inventory turnover report', () => {
      const sql = 'WITH cogs AS (SELECT product_id, SUM(quantity * cost) as total_cogs FROM order_products op JOIN products p ON op.product_id = p.id WHERE op.order_date >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY product_id), avg_stock AS (SELECT product_id, AVG(quantity) as avg_inventory FROM inventory GROUP BY product_id) SELECT p.id, p.name, cogs.total_cogs, avg_stock.avg_inventory, ROUND(cogs.total_cogs / NULLIF(avg_stock.avg_inventory, 0), 2) as turnover_ratio FROM products p JOIN cogs ON p.id = cogs.product_id JOIN avg_stock ON p.id = avg_stock.product_id ORDER BY turnover_ratio DESC';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });
  });

  // ============================================================
  // 7. AUDIT & COMPLIANCE QUERIES
  // ============================================================
  describe('Audit & Compliance Queries', () => {
    it('audit log with trail', () => {
      const sql = 'SELECT al.*, u.username as changed_by, al.old_values, al.new_values, al.changed_at, al.ip_address FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.table_name = \'orders\' AND al.changed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY al.changed_at DESC';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
    });

    it('data change tracking trigger', () => {
      const sql = 'CREATE TRIGGER trg_audit_orders AFTER UPDATE ON orders FOR EACH ROW BEGIN IF OLD.status != NEW.status THEN INSERT INTO audit_trail (table_name, record_id, field_name, old_value, new_value, changed_by, changed_at) VALUES (\'orders\', NEW.id, \'status\', OLD.status, NEW.status, NEW.modified_by, NOW()); END IF; END';
      const trigger = parseTrigger(sql);
      expect(trigger.name).toBe('trg_audit_orders');
      expect(trigger.events).toContain('UPDATE');
    });

    it('compliance report (SOX)', () => {
      const sql = 'WITH transactions AS (SELECT id, account_id, amount, type, created_at FROM financial_transactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)), summaries AS (SELECT account_id, type, COUNT(*) as txn_count, SUM(amount) as total_amount FROM transactions GROUP BY account_id, type) SELECT a.id, a.account_name, a.account_type, COALESCE(s_debits.txn_count, 0) as debit_count, COALESCE(s_debits.total_amount, 0) as debit_total, COALESCE(s_credits.txn_count, 0) as credit_count, COALESCE(s_credits.total_amount, 0) as credit_total FROM accounts a LEFT JOIN summaries s_debits ON a.id = s_debits.account_id AND s_debits.type = \'debit\' LEFT JOIN summaries s_credits ON a.id = s_credits.account_id AND s_credits.type = \'credit\' ORDER BY a.account_name';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });
  });

  // ============================================================
  // 8. MULTI-TENANT QUERIES
  // ============================================================
  describe('Multi-Tenant Queries', () => {
    it('tenant data isolation', () => {
      const sql = 'SELECT o.*, c.name as customer_name FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.tenant_id = 1 AND o.order_date >= \'2026-01-01\' ORDER BY o.order_date DESC';
      const result = parseEnterprise(sql);
      expect(result.type).toBe('query');
    });

    it('tenant analytics dashboard', () => {
      const sql = 'WITH tenant_stats AS (SELECT tenant_id, COUNT(DISTINCT customer_id) as customers, COUNT(*) as orders, SUM(total) as revenue FROM orders WHERE tenant_id = 1 GROUP BY tenant_id), monthly_trend AS (SELECT DATE_FORMAT(order_date, \'%Y-%m\') as month, SUM(total) as revenue FROM orders WHERE tenant_id = 1 GROUP BY DATE_FORMAT(order_date, \'%Y-%m\')) SELECT ts.*, mt.month, mt.revenue as monthly_revenue FROM tenant_stats ts CROSS JOIN monthly_trend mt ORDER BY mt.month DESC';
      const result = parseEnterprise(sql);
      expect(result.ctes).toHaveLength(2);
    });
  });

  // ============================================================
  // 9. STORED PROCEDURES
  // ============================================================
  describe('Stored Procedures', () => {
    it('process order procedure', () => {
      const sql = 'CALL process_order(12345, \'pending\', \'processing\')';
      const result = parseStoredProcedure(sql);
      expect(result.type).toBe('call');
      expect(result.data).toEqual({ name: 'process_order', parameters: ['12345', 'pending', 'processing'] });
    });

    it('calculate tax function', () => {
      const sql = 'CREATE FUNCTION calculate_tax(amount DECIMAL(10,2), tax_rate DECIMAL(5,2)) RETURNS DECIMAL(10,2) BEGIN RETURN amount * tax_rate / 100; END';
      const result = parseStoredProcedure(sql);
      expect(result.type).toBe('create');
    });
  });

  // ============================================================
  // 10. TRANSACTIONS
  // ============================================================
  describe('Transactions', () => {
    it('nested transaction with savepoint', () => {
      const result1 = parseTransaction('BEGIN');
      expect(result1.type).toBe('begin');
      
      const result2 = parseTransaction('SAVEPOINT sp_order');
      expect(result2.type).toBe('savepoint');
      expect(result2.data).toEqual({ name: 'sp_order' });
      
      const result3 = parseTransaction('ROLLBACK TO SAVEPOINT sp_order');
      expect(result3.type).toBe('rollback');
      expect(result3.data).toEqual({ name: 'sp_order' });
      
      const result4 = parseTransaction('COMMIT');
      expect(result4.type).toBe('commit');
    });

    it('transaction with isolation level', () => {
      const result = parseTransaction('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      expect(result.type).toBe('set_isolation');
    });
  });

  // ============================================================
  // 11. DDL OPERATIONS
  // ============================================================
  describe('DDL Operations', () => {
    it('create ERP schema', () => {
      const columns = [
        { name: 'id', type: 'SERIAL', primaryKey: true },
        { name: 'tenant_id', type: 'INTEGER', nullable: false },
        { name: 'name', type: 'VARCHAR', length: 255, nullable: false },
        { name: 'email', type: 'VARCHAR', length: 255 },
        { name: 'phone', type: 'VARCHAR', length: 20 },
        { name: 'status', type: 'VARCHAR', length: 20, defaultValue: 'active' },
        { name: 'created_at', type: 'TIMESTAMP', defaultValue: 'NOW()' },
      ];
      const result = compileCreateTable('customers', columns, pgOpts);
      expect(result).toContain('CREATE TABLE customers');
      expect(result).toContain('id SERIAL');
      expect(result).toContain('tenant_id INTEGER NOT NULL');
      expect(result).toContain('PRIMARY KEY');
    });

    it('create index for performance', () => {
      const idx = { name: 'idx_orders_tenant_date', table: 'orders', columns: ['tenant_id', 'order_date'] };
      const result = compileCreateIndex(idx, pgOpts);
      expect(result).toContain('CREATE INDEX idx_orders_tenant_date ON orders (tenant_id, order_date)');
    });

    it('alter table for schema evolution', () => {
      const op = { type: 'ADD_COLUMN' as const, table: 'customers', column: { name: 'loyalty_points', type: 'INTEGER', defaultValue: 0 } };
      const result = compileAlterTable(op, pgOpts);
      expect(result).toContain('ALTER TABLE customers ADD COLUMN loyalty_points INTEGER DEFAULT 0');
    });
  });

  // ============================================================
  // 12. MULTI-DIALECT COMPILATION
  // ============================================================
  describe('Multi-Dialect Compilation', () => {
    it('CTE compiles for MySQL', () => {
      const ctes = [{ name: 'cte', query: { type: 'select' as const, sql: 'SELECT * FROM t' } }];
      const result = compileCTE(ctes, mysqlOpts);
      expect(result).toBe('WITH cte AS (SELECT * FROM t)');
    });

    it('CTE compiles for PostgreSQL', () => {
      const ctes = [{ name: 'cte', materialized: 'MATERIALIZED' as const, query: { type: 'select' as const, sql: 'SELECT * FROM t' } }];
      const result = compileCTE(ctes, pgOpts);
      expect(result).toContain('MATERIALIZED');
    });

    it('stored procedure compiles for MySQL', () => {
      const proc = { name: 'test_proc', parameters: [{ name: 'p1', type: 'INT', direction: 'IN' as const }], body: 'SELECT 1;' };
      const result = compileStoredProcedure(proc, mysqlOpts);
      expect(result).toContain('CREATE PROCEDURE test_proc(IN p1 INT)');
    });

    it('stored procedure compiles for PostgreSQL', () => {
      const proc = { name: 'test_proc', parameters: [{ name: 'p1', type: 'INTEGER' }], body: 'PERFORM 1;' };
      const result = compileStoredProcedure(proc, pgOpts);
      expect(result).toContain('CREATE OR REPLACE FUNCTION test_proc(p1 INTEGER)');
      expect(result).toContain('$$ LANGUAGE plpgsql');
    });

    it('trigger compiles for MySQL', () => {
      const trigger = { name: 'audit', timing: 'AFTER' as const, events: ['UPDATE' as const], table: 'orders', forEachRow: true, body: 'INSERT INTO log VALUES(NEW.id);' };
      const result = compileTrigger(trigger, mysqlOpts);
      expect(result).toContain('CREATE TRIGGER audit');
      expect(result).toContain('AFTER UPDATE ON orders');
    });

    it('trigger compiles for PostgreSQL', () => {
      const trigger = { name: 'audit', timing: 'AFTER' as const, events: ['UPDATE' as const], table: 'orders', forEachRow: true, body: 'INSERT INTO log VALUES(NEW.id);' };
      const result = compileTrigger(trigger, pgOpts);
      expect(result).toContain('CREATE OR REPLACE FUNCTION audit_fn()');
      expect(result).toContain('CREATE TRIGGER audit');
    });

    it('transaction compiles for MySQL', () => {
      const result = compileTransaction('begin', mysqlOpts, { level: 'REPEATABLE READ' });
      expect(result).toContain('START TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    });

    it('transaction compiles for PostgreSQL', () => {
      const result = compileTransaction('begin', pgOpts, { level: 'SERIALIZABLE', readOnly: true });
      expect(result).toContain('ISOLATION LEVEL SERIALIZABLE');
      expect(result).toContain('READ ONLY');
    });
  });
});
