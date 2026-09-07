// =====================================================
// JSDB - SQL Parser Tests
// Comprehensive tests for native SQL parsing
// =====================================================
import { describe, it, expect } from 'vitest';
import { parseSQL, sqlToIR } from '../../src/ir/sql-parser.js';
import { nativeQueryToIR, detectDialect } from '../../src/ir/native-query.js';

describe('SQL Parser', () => {
  describe('SELECT parsing', () => {
    it('parses simple SELECT *', () => {
      const result = parseSQL('SELECT * FROM users');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.from.table).toBe('users');
        expect(result.columns).toHaveLength(1);
        expect(result.columns[0].expr).toBe('*');
      }
    });

    it('parses SELECT with specific columns', () => {
      const result = parseSQL('SELECT id, name, email FROM users');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.columns).toHaveLength(3);
        expect(result.columns[0].expr).toBe('id');
        expect(result.columns[1].expr).toBe('name');
        expect(result.columns[2].expr).toBe('email');
      }
    });

    it('parses SELECT with table alias', () => {
      const result = parseSQL('SELECT u.id, u.name FROM users AS u');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.from.table).toBe('users');
        expect(result.from.alias).toBe('u');
      }
    });

    it('parses SELECT DISTINCT', () => {
      const result = parseSQL('SELECT DISTINCT status FROM users');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.distinct).toBe(true);
      }
    });
  });

  describe('WHERE clause parsing', () => {
    it('parses simple equality', () => {
      const result = parseSQL('SELECT * FROM users WHERE age = 18');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: 18 });
      }
    });

    it('parses comparison operators', () => {
      const result = parseSQL('SELECT * FROM users WHERE age > 18');
      expect(result.type).toBe('SELECT');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: { $gt: 18 } });
      }
    });

    it('parses >= operator', () => {
      const result = parseSQL('SELECT * FROM users WHERE age >= 21');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: { $gte: 21 } });
      }
    });

    it('parses < operator', () => {
      const result = parseSQL('SELECT * FROM users WHERE age < 65');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: { $lt: 65 } });
      }
    });

    it('parses <= operator', () => {
      const result = parseSQL('SELECT * FROM users WHERE age <= 30');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: { $lte: 30 } });
      }
    });

    it('parses != operator', () => {
      const result = parseSQL('SELECT * FROM users WHERE status != "inactive"');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ status: { $ne: 'inactive' } });
      }
    });

    it('parses <> operator', () => {
      const result = parseSQL('SELECT * FROM users WHERE status <> "inactive"');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ status: { $ne: 'inactive' } });
      }
    });

    it('parses IN clause', () => {
      const result = parseSQL('SELECT * FROM users WHERE status IN ("active", "pending")');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ status: { $in: ['active', 'pending'] } });
      }
    });

    it('parses NOT IN clause', () => {
      const result = parseSQL('SELECT * FROM users WHERE status NOT IN ("banned", "deleted")');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ status: { $nin: ['banned', 'deleted'] } });
      }
    });

    it('parses BETWEEN', () => {
      const result = parseSQL('SELECT * FROM users WHERE age BETWEEN 18 AND 65');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ age: { $gte: 18, $lte: 65 } });
      }
    });

    it('parses LIKE', () => {
      const result = parseSQL('SELECT * FROM users WHERE name LIKE "%john%"');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ name: { $like: '%john%' } });
      }
    });

    it('parses IS NULL', () => {
      const result = parseSQL('SELECT * FROM users WHERE email IS NULL');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ email: null });
      }
    });

    it('parses IS NOT NULL', () => {
      const result = parseSQL('SELECT * FROM users WHERE email IS NOT NULL');
      if (result.type === 'SELECT') {
        expect(result.where).toEqual({ email: { $ne: null } });
      }
    });

    it('parses AND conditions', () => {
      const result = parseSQL('SELECT * FROM users WHERE age > 18 AND status = "active"');
      if (result.type === 'SELECT') {
        expect(result.where).toHaveProperty('$and');
        const and = result.where!.$and as Array<Record<string, unknown>>;
        expect(and).toHaveLength(2);
      }
    });

    it('parses OR conditions', () => {
      const result = parseSQL('SELECT * FROM users WHERE age > 18 OR status = "admin"');
      if (result.type === 'SELECT') {
        expect(result.where).toHaveProperty('$or');
        const or = result.where!.$or as Array<Record<string, unknown>>;
        expect(or).toHaveLength(2);
      }
    });

    it('parses complex AND/OR', () => {
      const result = parseSQL('SELECT * FROM users WHERE (age > 18 AND status = "active") OR role = "admin"');
      if (result.type === 'SELECT') {
        // Should have $or at top level
        expect(result.where).toHaveProperty('$or');
      }
    });

    it('parses NOT', () => {
      const result = parseSQL('SELECT * FROM users WHERE NOT status = "inactive"');
      if (result.type === 'SELECT') {
        expect(result.where).toHaveProperty('$not');
      }
    });
  });

  describe('ORDER BY parsing', () => {
    it('parses single column ASC', () => {
      const result = parseSQL('SELECT * FROM users ORDER BY name ASC');
      if (result.type === 'SELECT') {
        expect(result.orderBy).toEqual({ name: 'asc' });
      }
    });

    it('parses single column DESC', () => {
      const result = parseSQL('SELECT * FROM users ORDER BY name DESC');
      if (result.type === 'SELECT') {
        expect(result.orderBy).toEqual({ name: 'desc' });
      }
    });

    it('parses multiple columns', () => {
      const result = parseSQL('SELECT * FROM users ORDER BY status ASC, name DESC');
      if (result.type === 'SELECT') {
        expect(result.orderBy).toEqual({ status: 'asc', name: 'desc' });
      }
    });
  });

  describe('LIMIT/OFFSET parsing', () => {
    it('parses LIMIT', () => {
      const result = parseSQL('SELECT * FROM users LIMIT 10');
      if (result.type === 'SELECT') {
        expect(result.limit).toBe(10);
      }
    });

    it('parses LIMIT OFFSET', () => {
      const result = parseSQL('SELECT * FROM users LIMIT 10 OFFSET 20');
      if (result.type === 'SELECT') {
        expect(result.limit).toBe(10);
        expect(result.offset).toBe(20);
      }
    });

    it('parses LIMIT with comma syntax', () => {
      const result = parseSQL('SELECT * FROM users LIMIT 20, 10');
      if (result.type === 'SELECT') {
        expect(result.limit).toBe(20);
        expect(result.offset).toBe(10);
      }
    });
  });

  describe('Aggregate functions', () => {
    it('parses COUNT(*)', () => {
      const result = parseSQL('SELECT COUNT(*) AS total FROM users');
      if (result.type === 'SELECT') {
        expect(result.columns[0]).toHaveProperty('alias', 'total');
      }
    });

    it('parses SUM', () => {
      const result = parseSQL('SELECT SUM(amount) AS total FROM orders');
      if (result.type === 'SELECT') {
        expect(result.columns[0]).toHaveProperty('alias', 'total');
      }
    });

    it('parses AVG', () => {
      const result = parseSQL('SELECT AVG(age) AS avg_age FROM users');
      if (result.type === 'SELECT') {
        expect(result.columns[0]).toHaveProperty('alias', 'avg_age');
      }
    });

    it('parses GROUP BY', () => {
      const result = parseSQL('SELECT status, COUNT(*) AS cnt FROM users GROUP BY status');
      if (result.type === 'SELECT') {
        expect(result.groupBy).toEqual(['status']);
      }
    });

    it('parses HAVING', () => {
      const result = parseSQL('SELECT status, COUNT(*) AS cnt FROM users GROUP BY status HAVING COUNT(*) > 5');
      if (result.type === 'SELECT') {
        expect(result.having).toBeDefined();
      }
    });
  });

  describe('JOIN parsing', () => {
    it('parses INNER JOIN', () => {
      const result = parseSQL('SELECT u.name, o.total FROM users AS u INNER JOIN orders AS o ON u.id = o.user_id');
      if (result.type === 'SELECT') {
        expect(result.from.joins).toHaveLength(1);
        expect(result.from.joins[0].type).toBe('INNER');
        expect(result.from.joins[0].table).toBe('orders');
      }
    });

    it('parses LEFT JOIN', () => {
      const result = parseSQL('SELECT u.name, o.total FROM users AS u LEFT JOIN orders AS o ON u.id = o.user_id');
      if (result.type === 'SELECT') {
        expect(result.from.joins[0].type).toBe('LEFT');
      }
    });

    it('parses RIGHT JOIN', () => {
      const result = parseSQL('SELECT u.name, o.total FROM users AS u RIGHT JOIN orders AS o ON u.id = o.user_id');
      if (result.type === 'SELECT') {
        expect(result.from.joins[0].type).toBe('RIGHT');
      }
    });

    it('parses multiple JOINs', () => {
      const result = parseSQL('SELECT u.name, o.total, p.name FROM users AS u INNER JOIN orders AS o ON u.id = o.user_id INNER JOIN products AS p ON o.product_id = p.id');
      if (result.type === 'SELECT') {
        expect(result.from.joins).toHaveLength(2);
      }
    });
  });

  describe('INSERT parsing', () => {
    it('parses INSERT with columns', () => {
      const result = parseSQL('INSERT INTO users (name, email, age) VALUES ("John", "john@example.com", 25)');
      expect(result.type).toBe('INSERT');
      if (result.type === 'INSERT') {
        expect(result.table).toBe('users');
        expect(result.columns).toEqual(['name', 'email', 'age']);
        expect(result.rows).toHaveLength(1);
        expect(result.rows![0]).toEqual(['John', 'john@example.com', 25]);
      }
    });

    it('parses INSERT with multiple rows', () => {
      const result = parseSQL('INSERT INTO users (name, age) VALUES ("John", 25), ("Jane", 30)');
      if (result.type === 'INSERT') {
        expect(result.rows).toHaveLength(2);
      }
    });
  });

  describe('UPDATE parsing', () => {
    it('parses UPDATE with SET', () => {
      const result = parseSQL('UPDATE users SET name = "John", age = 26 WHERE id = 1');
      expect(result.type).toBe('UPDATE');
      if (result.type === 'UPDATE') {
        expect(result.table).toBe('users');
        expect(result.setClauses).toHaveLength(2);
        expect(result.where).toEqual({ id: 1 });
      }
    });

    it('parses UPDATE without WHERE', () => {
      const result = parseSQL('UPDATE users SET status = "active"');
      if (result.type === 'UPDATE') {
        expect(result.setClauses).toHaveLength(1);
        expect(result.where).toBeUndefined();
      }
    });
  });

  describe('DELETE parsing', () => {
    it('parses DELETE with WHERE', () => {
      const result = parseSQL('DELETE FROM users WHERE id = 1');
      expect(result.type).toBe('DELETE');
      if (result.type === 'DELETE') {
        expect(result.table).toBe('users');
        expect(result.where).toEqual({ id: 1 });
      }
    });

    it('parses DELETE without WHERE', () => {
      const result = parseSQL('DELETE FROM users');
      if (result.type === 'DELETE') {
        expect(result.where).toBeUndefined();
      }
    });
  });

  describe('SQL to IR conversion', () => {
    it('converts SELECT to find IR', () => {
      const parsed = parseSQL('SELECT * FROM users WHERE age > 18');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('find');
      expect(ir.collection).toBe('users');
    });

    it('converts SELECT with aggregates to aggregate IR', () => {
      const parsed = parseSQL('SELECT status, COUNT(*) AS cnt FROM users GROUP BY status');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('aggregate');
    });

    it('converts INSERT to insert IR', () => {
      const parsed = parseSQL('INSERT INTO users (name, age) VALUES ("John", 25)');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('insert');
      expect(ir.collection).toBe('users');
    });

    it('converts INSERT with multiple rows to insertMany IR', () => {
      const parsed = parseSQL('INSERT INTO users (name, age) VALUES ("John", 25), ("Jane", 30)');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('insertMany');
    });

    it('converts UPDATE to updateMany IR', () => {
      const parsed = parseSQL('UPDATE users SET status = "active" WHERE age > 18');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('updateMany');
      expect(ir.collection).toBe('users');
    });

    it('converts DELETE to deleteMany IR', () => {
      const parsed = parseSQL('DELETE FROM users WHERE id = 1');
      const ir = sqlToIR(parsed);
      expect(ir.type).toBe('deleteMany');
      expect(ir.collection).toBe('users');
    });
  });
});

describe('Dialect Detection', () => {
  it('detects SQL from SELECT string', () => {
    expect(detectDialect('SELECT * FROM users')).toBe('sql');
  });

  it('detects SQL from INSERT string', () => {
    expect(detectDialect('INSERT INTO users (name) VALUES ("John")')).toBe('sql');
  });

  it('detects SQL from UPDATE string', () => {
    expect(detectDialect('UPDATE users SET name = "John"')).toBe('sql');
  });

  it('detects SQL from DELETE string', () => {
    expect(detectDialect('DELETE FROM users WHERE id = 1')).toBe('sql');
  });

  it('detects MongoDB from pipeline array', () => {
    expect(detectDialect([{ $match: { status: 'active' } }])).toBe('mongodb');
  });
});

describe('Native Query Translation', () => {
  it('translates SQL to find IR', () => {
    const result = nativeQueryToIR('SELECT * FROM users WHERE age > 18 ORDER BY name LIMIT 10', {
      targetDatabase: 'mongodb',
    });
    expect(result.ir.type).toBe('find');
    expect(result.sourceDialect).toBe('sql');
  });

  it('translates SQL INSERT to insert IR', () => {
    const result = nativeQueryToIR('INSERT INTO users (name, age) VALUES ("John", 25)', {
      targetDatabase: 'mysql',
    });
    expect(result.ir.type).toBe('insert');
  });

  it('translates SQL UPDATE to updateMany IR', () => {
    const result = nativeQueryToIR('UPDATE users SET status = "active" WHERE age > 18', {
      targetDatabase: 'postgres',
    });
    expect(result.ir.type).toBe('updateMany');
  });

  it('translates SQL DELETE to deleteMany IR', () => {
    const result = nativeQueryToIR('DELETE FROM users WHERE id = 1', {
      targetDatabase: 'sqlite',
    });
    expect(result.ir.type).toBe('deleteMany');
  });

  it('translates MongoDB pipeline to aggregate IR', () => {
    const result = nativeQueryToIR([
      { $match: { status: 'active' } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ], {
      targetDatabase: 'mysql',
    });
    expect(result.ir.type).toBe('aggregate');
  });
});

describe('Complex SQL Queries', () => {
  it('parses SELECT with multiple WHERE conditions', () => {
    const result = parseSQL('SELECT * FROM users WHERE age > 18 AND status = "active" AND name LIKE "%john%"');
    if (result.type === 'SELECT') {
      expect(result.where).toHaveProperty('$and');
    }
  });

  it('parses SELECT with subquery in WHERE', () => {
    const result = parseSQL('SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)');
    if (result.type === 'SELECT') {
      expect(result.where).toBeDefined();
    }
  });

  it('parses SELECT with column aliases', () => {
    const result = parseSQL('SELECT name AS full_name, email AS contact FROM users');
    if (result.type === 'SELECT') {
      expect(result.columns[0].alias).toBe('full_name');
      expect(result.columns[1].alias).toBe('contact');
    }
  });

  it('parses SELECT with multiple aggregate functions', () => {
    const result = parseSQL('SELECT status, COUNT(*) AS cnt, AVG(age) AS avg_age, SUM(amount) AS total FROM users GROUP BY status HAVING COUNT(*) > 5 ORDER BY total DESC');
    if (result.type === 'SELECT') {
      expect(result.groupBy).toEqual(['status']);
      expect(result.having).toBeDefined();
      expect(result.orderBy).toEqual({ total: 'desc' });
    }
  });

  it('parses SELECT with LEFT JOIN and WHERE', () => {
    const result = parseSQL('SELECT u.name, o.total FROM users AS u LEFT JOIN orders AS o ON u.id = o.user_id WHERE o.total > 100');
    if (result.type === 'SELECT') {
      expect(result.from.joins).toHaveLength(1);
      expect(result.from.joins[0].type).toBe('LEFT');
      expect(result.where).toBeDefined();
    }
  });
});
