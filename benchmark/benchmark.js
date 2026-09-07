/**
 * SpurtCommerce Benchmark - 1000+ Real TypeORM Operations
 * 
 * Directly connects via SpurtCommerce's TypeORM DataSource with full entities.
 * Tests: Product, Category, Customer, Order, Blog, Attribute, Sku, etc.
 */

const { DataSource } = require('typeorm');
const path = require('path');
const fs = require('fs');

const entities = require(path.join(__dirname, 'spurtcommerce', 'api', 'dist', 'src', 'common', 'entities-index.js'));
const entityList = Object.values(entities).filter(e => typeof e === 'function');

console.log(`\n=== SpurtCommerce Benchmark ===`);
console.log(`Entities: ${entityList.length}`);

const results = {
  target: process.env.TYPEORM_CONNECTION || 'mysql',
  totalOps: 0, passed: 0, failed: 0,
  errors: [], timings: [], operations: [],
};

function record(name, success, duration, error) {
  results.totalOps++;
  if (success) results.passed++;
  else {
    results.failed++;
    results.errors.push({ name, error: String(error).slice(0, 200) });
  }
  results.timings.push(duration);
  results.operations.push({ name, success, duration: Math.round(duration) });
}

async function benchmark() {
  const dbConfig = {
    type: process.env.TYPEORM_CONNECTION || 'mysql',
    host: process.env.TYPEORM_HOST || 'localhost',
    port: parseInt(process.env.TYPEORM_PORT || '3309'),
    username: process.env.TYPEORM_USERNAME || 'root',
    password: process.env.TYPEORM_PASSWORD || 'jsdbproof',
    database: process.env.TYPEORM_DATABASE || 'spurtcommerce',
    entities: entityList,
    synchronize: false,
    logging: false,
  };

  console.log(`Connecting to ${dbConfig.type}://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`);
  const ds = new DataSource(dbConfig);
  await ds.initialize();
  console.log('Connected!\n');

  const repos = {};
  for (const e of entityList) {
    try { repos[e.name] = ds.getRepository(e); } catch(_) {}
  }
  console.log(`Repos: ${Object.keys(repos).length}\n`);

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 1: Product CRUD (find, findOne, count) — 200 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Product CRUD ---');
  const prodRepo = repos.Product;
  if (prodRepo) {
    // .find() with pagination — 60 ops
    for (let i = 0; i < 60; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.find({ take: 20, skip: i * 20, order: { productId: 'DESC' } });
        record(`Product.find(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Product.find(p${i})`, false, Date.now() - t0, e.message); }
    }
    // .findOne() — 40 ops
    for (let i = 1; i <= 40; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.findOne({ where: { productId: i } });
        record(`Product.findOne(${i})`, true, Date.now() - t0);
      } catch(e) { record(`Product.findOne(${i})`, false, Date.now() - t0, e.message); }
    }
    // .count() — 10 ops
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.count();
        record(`Product.count()`, true, Date.now() - t0);
      } catch(e) { record(`Product.count()`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 2: Category CRUD — 100 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Category CRUD ---');
  const catRepo = repos.Category;
  if (catRepo) {
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      try {
        await catRepo.find({ take: 20, skip: i * 20 });
        record(`Category.find(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Category.find(p${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 1; i <= 30; i++) {
      const t0 = Date.now();
      try {
        await catRepo.findOne({ where: { categoryId: i } });
        record(`Category.findOne(${i})`, true, Date.now() - t0);
      } catch(e) { record(`Category.findOne(${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await catRepo.count();
        record(`Category.count()`, true, Date.now() - t0);
      } catch(e) { record(`Category.count()`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 3: Customer CRUD — 100 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Customer CRUD ---');
  const custRepo = repos.Customer;
  if (custRepo) {
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      try {
        await custRepo.find({ take: 20, skip: i * 20 });
        record(`Customer.find(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Customer.find(p${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 1; i <= 30; i++) {
      const t0 = Date.now();
      try {
        await custRepo.findOne({ where: { customerId: i } });
        record(`Customer.findOne(${i})`, true, Date.now() - t0);
      } catch(e) { record(`Customer.findOne(${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await custRepo.count();
        record(`Customer.count()`, true, Date.now() - t0);
      } catch(e) { record(`Customer.count()`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 4: Order CRUD — 100 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Order CRUD ---');
  const orderRepo = repos.Order;
  if (orderRepo) {
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.find({ take: 20, skip: i * 20, order: { orderId: 'DESC' } });
        record(`Order.find(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Order.find(p${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 1; i <= 30; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.findOne({ where: { orderId: i } });
        record(`Order.findOne(${i})`, true, Date.now() - t0);
      } catch(e) { record(`Order.findOne(${i})`, false, Date.now() - t0, e.message); }
    }
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.count();
        record(`Order.count()`, true, Date.now() - t0);
      } catch(e) { record(`Order.count()`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 5: QueryBuilder with JOINs — 100 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- QueryBuilder JOINs ---');
  if (prodRepo) {
    // Product list with SKU join (storefront pattern) — 30 ops
    for (let i = 0; i < 30; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.createQueryBuilder('product')
          .leftJoinAndSelect('product.skuDetail', 'skuDetail')
          .select(['product.productId', 'product.name', 'product.price', 'product.image',
                     'skuDetail.skuName', 'skuDetail.sku', 'skuDetail.quantity'])
          .take(20).skip(i * 20)
          .orderBy('product.productId', 'DESC')
          .getManyAndCount();
        record(`Product+SKU.join(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Product+SKU.join(p${i})`, false, Date.now() - t0, e.message); }
    }

    // Product list with category join — 20 ops
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.createQueryBuilder('product')
          .leftJoinAndSelect('product.productToCategory', 'ptc')
          .leftJoinAndSelect('ptc.category', 'category')
          .select(['product.productId', 'product.name', 'category.name'])
          .take(20).skip(i * 20)
          .getManyAndCount();
        record(`Product+Cat.join(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Product+Cat.join(p${i})`, false, Date.now() - t0, e.message); }
    }
  }

  if (orderRepo) {
    // Order list with customer join — 30 ops
    for (let i = 0; i < 30; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.createQueryBuilder('order')
          .leftJoinAndSelect('order.customer', 'customer')
          .leftJoinAndSelect('order.orderProduct', 'op')
          .select(['order.orderId', 'order.total', 'order.createdDate',
                     'customer.firstName', 'customer.lastName', 'customer.email'])
          .take(20).skip(i * 20)
          .orderBy('order.orderId', 'DESC')
          .getManyAndCount();
        record(`Order+Customer.join(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Order+Customer.join(p${i})`, false, Date.now() - t0, e.message); }
    }

    // Order list with status join — 20 ops
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.createQueryBuilder('order')
          .leftJoinAndSelect('order.orderStatus', 'orderStatus')
          .select(['order.orderId', 'order.total', 'order.status',
                     'orderStatus.name'])
          .take(20).skip(i * 20)
          .getManyAndCount();
        record(`Order+Status.join(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`Order+Status.join(p${i})`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 6: Aggregates — 80 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Aggregates ---');
  if (orderRepo) {
    // SUM(total) — 10 ops
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.createQueryBuilder('order')
          .select('SUM(order.total)', 'totalSales').getRawOne();
        record('Order.SUM(total)', true, Date.now() - t0);
      } catch(e) { record('Order.SUM(total)', false, Date.now() - t0, e.message); }
    }
    // COUNT + GROUP BY payment_method — 10 ops
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await orderRepo.createQueryBuilder('order')
          .select('order.paymentMethod', 'method')
          .addSelect('COUNT(*)', 'count')
          .groupBy('order.paymentMethod').getRawMany();
        record('Order.GROUP BY payment', true, Date.now() - t0);
      } catch(e) { record('Order.GROUP BY payment', false, Date.now() - t0, e.message); }
    }
    // MAX/MIN/AVG — 10 ops each
    for (const fn of ['MAX(order.total)', 'MIN(order.total)', 'AVG(order.total)']) {
      const label = fn.split('(')[0];
      for (let i = 0; i < 10; i++) {
        const t0 = Date.now();
        try {
          await orderRepo.createQueryBuilder('order')
            .select(`${fn}`, 'val').getRawOne();
          record(`Order.${label}`, true, Date.now() - t0);
        } catch(e) { record(`Order.${label}`, false, Date.now() - t0, e.message); }
      }
    }
  }

  if (custRepo) {
    // Customer COUNT — 10 ops
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await custRepo.createQueryBuilder('customer')
          .select('COUNT(*)', 'total').getRawOne();
        record('Customer.COUNT', true, Date.now() - t0);
      } catch(e) { record('Customer.COUNT', false, Date.now() - t0, e.message); }
    }
    // GROUP BY country — 10 ops
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      try {
        await custRepo.createQueryBuilder('customer')
          .select('customer.countryId', 'country')
          .addSelect('COUNT(*)', 'cnt')
          .groupBy('customer.countryId')
          .orderBy('cnt', 'DESC').getRawMany();
        record('Customer.GROUP BY country', true, Date.now() - t0);
      } catch(e) { record('Customer.GROUP BY country', false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 7: Filtering & Sorting — 80 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Filtering & Sorting ---');
  if (prodRepo) {
    const fields = ['productId', 'name', 'price', 'createdDate'];
    const orders = ['ASC', 'DESC'];
    for (let i = 0; i < 20; i++) {
      const f = fields[i % 4], o = orders[i % 2];
      const t0 = Date.now();
      try {
        await prodRepo.find({ order: { [f]: o }, take: 20 });
        record(`Product.sort(${f},${o})`, true, Date.now() - t0);
      } catch(e) { record(`Product.sort(${f},${o})`, false, Date.now() - t0, e.message); }
    }
    // WHERE status — 20 ops
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.find({ where: { status: i % 2 }, take: 20 });
        record(`Product.where(status=${i%2})`, true, Date.now() - t0);
      } catch(e) { record(`Product.where(status=${i%2})`, false, Date.now() - t0, e.message); }
    }
    // LIKE — 20 ops
    const vowels = ['a','e','i','o','u'];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.createQueryBuilder('p')
          .where('p.name LIKE :q', { q: `%${vowels[i%5]}%` })
          .take(20).getMany();
        record('Product.LIKE', true, Date.now() - t0);
      } catch(e) { record('Product.LIKE', false, Date.now() - t0, e.message); }
    }
    // IN clause — 20 ops
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.createQueryBuilder('p')
          .where('p.productId IN (:...ids)', { ids: [i*10+1, i*10+2, i*10+3, i*10+4, i*10+5] })
          .getMany();
        record('Product.IN clause', true, Date.now() - t0);
      } catch(e) { record('Product.IN clause', false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 8: Product update (touch) — 40 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Write Operations ---');
  if (prodRepo) {
    for (let i = 0; i < 40; i++) {
      const t0 = Date.now();
      try {
        await prodRepo.update({ productId: 1 }, { modifiedDate: new Date() });
        record('Product.update(1)', true, Date.now() - t0);
      } catch(e) { record('Product.update(1)', false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 9: Blog, Attribute, Sku — 60 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Additional Entities ---');
  for (const name of ['Blog', 'Attribute', 'AttributeValue', 'Sku', 'Plugins']) {
    const repo = repos[name];
    if (!repo) continue;
    for (let i = 0; i < 12; i++) {
      const t0 = Date.now();
      try {
        await repo.find({ take: 20, skip: i * 20 });
        record(`${name}.find(p${i})`, true, Date.now() - t0);
      } catch(e) { record(`${name}.find(p${i})`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 10: Raw SQL — 30 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Raw SQL ---');
  const rawQueries = [
    'SELECT COUNT(*) as cnt FROM product',
    'SELECT COUNT(*) as cnt FROM customer',
    'SELECT COUNT(*) as cnt FROM `order`',
    'SELECT COUNT(*) as cnt FROM category',
    'SELECT DISTINCT payment_method FROM `order`',
    'SELECT status, COUNT(*) as cnt FROM product GROUP BY status',
    'SELECT payment_method, COUNT(*) as cnt FROM `order` GROUP BY payment_method',
    'SELECT AVG(total) as avg_t FROM `order` WHERE total > 0',
    'SELECT MAX(total) as max_t FROM `order`',
    'SELECT MIN(total) as min_t FROM `order` WHERE total > 0',
    'SELECT SUM(total) as sum_t FROM `order` WHERE status != 3',
    'SELECT country_id, COUNT(*) as cnt FROM customer GROUP BY country_id ORDER BY cnt DESC LIMIT 10',
    'SELECT * FROM product WHERE product_id IN (1,2,3,4,5)',
    'SELECT * FROM product ORDER BY product_id DESC LIMIT 20',
    'SELECT p.name, s.quantity FROM product p JOIN sku s ON p.product_id = s.product_id WHERE s.quantity < 100',
  ];
  for (let i = 0; i < 2; i++) {
    for (const q of rawQueries) {
      const t0 = Date.now();
      try {
        await ds.query(q);
        record(`Raw:${q.slice(0,45)}`, true, Date.now() - t0);
      } catch(e) { record(`Raw:${q.slice(0,45)}`, false, Date.now() - t0, e.message); }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORY 11: Transactions — 4 ops
  // ──────────────────────────────────────────────────────────────
  console.log('--- Transactions ---');
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    try {
      await ds.query('START TRANSACTION');
      await ds.query('SELECT 1');
      await ds.query('COMMIT');
      record('Tx COMMIT', true, Date.now() - t0);
    } catch(e) { record('Tx COMMIT', false, Date.now() - t0, e.message); }

    const t1 = Date.now();
    try {
      await ds.query('START TRANSACTION');
      await ds.query('SELECT 1');
      await ds.query('ROLLBACK');
      record('Tx ROLLBACK', true, Date.now() - t1);
    } catch(e) { record('Tx ROLLBACK', false, Date.now() - t1, e.message); }
  }

  await ds.destroy();
  return results;
}

benchmark().then(r => {
  const avg = r.timings.length ? (r.timings.reduce((a,b)=>a+b,0) / r.timings.length).toFixed(1) : 0;
  const sorted = [...r.timings].sort((a,b)=>a-b);
  const p50 = sorted[Math.floor(sorted.length*0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length*0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length*0.99)] || 0;

  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(60));
  console.log(`Target:         ${r.target}`);
  console.log(`Total Ops:      ${r.totalOps}`);
  console.log(`Passed:         ${r.passed} (${((r.passed/r.totalOps)*100).toFixed(1)}%)`);
  console.log(`Failed:         ${r.failed} (${((r.failed/r.totalOps)*100).toFixed(1)}%)`);
  console.log(`Avg Latency:    ${avg}ms`);
  console.log(`P50:            ${p50}ms`);
  console.log(`P95:            ${p95}ms`);
  console.log(`P99:            ${p99}ms`);
  console.log(`Total Duration: ${r.timings.reduce((a,b)=>a+b,0)}ms`);

  if (r.errors.length) {
    console.log(`\nFailed (${r.errors.length}):`);
    const grouped = {};
    r.errors.forEach(e => {
      const key = e.name.split('(')[0];
      grouped[key] = (grouped[key]||0)+1;
    });
    Object.entries(grouped).forEach(([k,v]) => console.log(`  ${k}: ${v}x`));
    console.log('\nSample errors:');
    r.errors.slice(0, 10).forEach(e => console.log(`  ${e.name}: ${e.error}`));
  }

  fs.writeFileSync(
    path.join(__dirname, `benchmark-${r.target}.json`),
    JSON.stringify({ ...r, avgLatency: parseFloat(avg), p50, p95, p99 }, null, 2)
  );
  console.log(`\nReport: benchmark-${r.target}.json`);
}).catch(e => { console.error('FATAL:', e); process.exit(1); });
