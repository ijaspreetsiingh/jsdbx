import { describe, it, expect } from 'vitest';
import { PortabilityAnalyzer } from '../../src/analyzers/portability.js';
import { PerformanceAnalyzer } from '../../src/analyzers/performance.js';
import { SecurityAnalyzer } from '../../src/analyzers/security.js';

describe('PortabilityAnalyzer', () => {
  const analyzer = new PortabilityAnalyzer();

  it('analyzes MySQL portability', () => {
    const result = analyzer.analyze('mysql');
    expect(result.database).toBe('mysql');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.portable.length).toBeGreaterThan(0);
    // Most ops are emulated — only a few may be unsupported (e.g., realtime.changeStreams)
    expect(result.unsupported.length).toBeLessThanOrEqual(2);
  });

  it('analyzes MongoDB portability — most ops native', () => {
    const result = analyzer.analyze('mongodb');
    expect(result.database).toBe('mongodb');
    expect(result.score).toBeGreaterThan(70);
    // MongoDB should have very few or zero unsupported
    expect(result.unsupported.length).toBeLessThanOrEqual(2);
  });

  it('generates portability report', () => {
    const result = analyzer.analyze('mysql');
    const report = analyzer.formatReport(result);
    expect(report).toContain('JSDB PORTABILITY REPORT');
    expect(report).toContain('MYSQL');
    expect(report).toContain('Score');
  });

  it('compares portability across databases', () => {
    const comparison = analyzer.comparePortability();
    expect(comparison.size).toBe(4);
    expect(comparison.has('mysql')).toBe(true);
    expect(comparison.has('mongodb')).toBe(true);
  });
});

describe('PerformanceAnalyzer', () => {
  it('returns empty report when no traces', () => {
    const analyzer = new PerformanceAnalyzer();
    const report = analyzer.analyze();
    expect(report.totalQueries).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('detects N+1 queries', () => {
    const analyzer = new PerformanceAnalyzer();
    for (let i = 0; i < 15; i++) {
      analyzer.recordTrace({
        requestId: `req-${i}`,
        queryId: `q-${i}`,
        database: 'mysql',
        adapter: 'mysql',
        operation: 'findOne',
        collection: 'orders',
        duration: 5,
        cacheHit: false,
        timestamp: new Date(),
      });
    }
    const report = analyzer.analyze();
    expect(report.findings.some((f) => f.type === 'n_plus_1')).toBe(true);
  });

  it('detects slow queries', () => {
    const analyzer = new PerformanceAnalyzer(100);
    analyzer.recordTrace({
      requestId: 'req1',
      queryId: 'q1',
      database: 'mysql',
      adapter: 'mysql',
      operation: 'find',
      collection: 'users',
      duration: 5000,
      cacheHit: false,
      timestamp: new Date(),
    });
    const report = analyzer.analyze();
    expect(report.findings.some((f) => f.type === 'slow_query')).toBe(true);
    expect(report.slowQueries).toBeGreaterThan(0);
  });

  it('formats performance report', () => {
    const analyzer = new PerformanceAnalyzer();
    analyzer.recordTrace({
      requestId: 'r1', queryId: 'q1', database: 'sqlite', adapter: 'sqlite',
      operation: 'find', collection: 'users', duration: 5, cacheHit: true, timestamp: new Date(),
    });
    const report = analyzer.analyze();
    const formatted = analyzer.formatReport(report);
    expect(formatted).toContain('JSDB PERFORMANCE REPORT');
  });
});

describe('SecurityAnalyzer', () => {
  const analyzer = new SecurityAnalyzer();

  it('flags missing authentication', () => {
    const report = analyzer.analyze({ hasAuthentication: false });
    expect(report.findings.some((f) => f.category === 'Authentication')).toBe(true);
  });

  it('flags raw query usage', () => {
    const report = analyzer.analyze({ rawQueryUsed: true });
    expect(report.findings.some((f) => f.category.includes('Injection'))).toBe(true);
  });

  it('calculates security score', () => {
    const noIssues = analyzer.analyze({
      hasAuthentication: true,
      hasAuthorization: true,
      hasRateLimit: true,
      hasInputValidation: true,
      tenancyEnabled: true,
      auditLogEnabled: true,
      tlsEnabled: true,
    });
    const withIssues = analyzer.analyze({ hasAuthentication: false, hasAuthorization: false });
    expect(noIssues.score).toBeGreaterThan(withIssues.score);
  });

  it('formats security report', () => {
    const report = analyzer.analyze({ hasAuthentication: false });
    const formatted = analyzer.formatReport(report);
    expect(formatted).toContain('JSDB SECURITY REPORT');
    expect(formatted).toContain('Disclaimer');
  });

  it('includes disclaimer in report', () => {
    const report = analyzer.analyze({});
    expect(report.disclaimer).toContain('static');
  });
});
