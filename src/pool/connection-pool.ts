// =====================================================
// JSDB v2.0 - Enterprise Connection Pool
// Health checks, load balancing, connection recycling
// =====================================================
import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';

export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  enableMetrics: boolean;
}

export interface PooledConnection<T = unknown> {
  id: string;
  connection: T;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  isHealthy: boolean;
}

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingAcquires: number;
  totalAcquires: number;
  totalReleases: number;
  totalErrors: number;
  avgAcquireTimeMs: number;
  maxAcquireTimeMs: number;
  connectionsCreated: number;
  connectionsDestroyed: number;
  healthCheckFailures: number;
}

export interface ConnectionFactory<T> {
  create(): Promise<T>;
  destroy(connection: T): Promise<void>;
  validate(connection: T): Promise<boolean>;
}

export class EnterpriseConnectionPool<T> {
  private config: PoolConfig;
  private factory: ConnectionFactory<T>;
  private logger = createLogger('info', 'JSDB:Pool');

  private idle: PooledConnection<T>[] = [];
  private active = new Map<string, PooledConnection<T>>();
  private waiting: Array<{
    resolve: (conn: PooledConnection<T>) => void;
    reject: (err: Error) => void;
    timestamp: number;
  }> = [];

  private metrics: PoolMetrics;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(factory: ConnectionFactory<T>, config?: Partial<PoolConfig>) {
    this.factory = factory;
    this.config = {
      min: config?.min ?? 5,
      max: config?.max ?? 50,
      acquireTimeoutMs: config?.acquireTimeoutMs ?? 10000,
      idleTimeoutMs: config?.idleTimeoutMs ?? 30000,
      maxLifetimeMs: config?.maxLifetimeMs ?? 3600000,
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 30000,
      healthCheckTimeoutMs: config?.healthCheckTimeoutMs ?? 5000,
      retryCount: config?.retryCount ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
      enableMetrics: config?.enableMetrics ?? true,
    };

    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingAcquires: 0,
      totalAcquires: 0,
      totalReleases: 0,
      totalErrors: 0,
      avgAcquireTimeMs: 0,
      maxAcquireTimeMs: 0,
      connectionsCreated: 0,
      connectionsDestroyed: 0,
      healthCheckFailures: 0,
    };
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing connection pool', {
      min: this.config.min,
      max: this.config.max,
    });

    const createPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.min; i++) {
      createPromises.push(this.createConnection());
    }
    await Promise.all(createPromises);

    this.startHealthCheck();
    this.logger.info('Connection pool initialized', {
      total: this.metrics.totalConnections,
    });
  }

  async acquire(): Promise<PooledConnection<T>> {
    if (this.destroyed) {
      throw new Error('Pool has been destroyed');
    }

    const startTime = Date.now();
    this.metrics.totalAcquires++;

    // Try to get idle connection
    const idleConn = this.getIdleConnection();
    if (idleConn) {
      this.updateAcquireMetrics(startTime);
      return idleConn;
    }

    // Create new connection if under limit
    if (this.active.size < this.config.max) {
      try {
        await this.createConnection();
        const conn = this.getIdleConnection()!;
        this.updateAcquireMetrics(startTime);
        return conn;
      } catch (err) {
        this.metrics.totalErrors++;
        throw err;
      }
    }

    // Wait for available connection
    return this.waitForConnection(startTime);
  }

  async release(conn: PooledConnection<T>): Promise<void> {
    if (!this.active.has(conn.id)) {
      return;
    }

    this.active.delete(conn.id);
    conn.lastUsedAt = Date.now();
    conn.useCount++;

    this.metrics.totalReleases++;

    // Check if connection is still healthy
    if (!conn.isHealthy) {
      await this.destroyConnection(conn);
      return;
    }

    // Check max lifetime
    if (this.isExpired(conn)) {
      await this.destroyConnection(conn);
      return;
    }

    // Return to idle pool
    this.idle.push(conn);
    this.metrics.idleConnections = this.idle.length;
    this.metrics.activeConnections = this.active.size;

    // Wake up waiting acquirer
    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      const newConn = this.getIdleConnection();
      if (newConn) {
        waiter.resolve(newConn);
      }
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Reject all waiters
    for (const waiter of this.waiting) {
      waiter.reject(new Error('Pool has been destroyed'));
    }
    this.waiting = [];

    // Destroy all connections
    const destroyPromises: Promise<void>[] = [];
    for (const conn of this.idle) {
      destroyPromises.push(this.destroyConnection(conn));
    }
    for (const conn of this.active.values()) {
      destroyPromises.push(this.destroyConnection(conn));
    }
    await Promise.all(destroyPromises);

    this.idle = [];
    this.active.clear();
    this.logger.info('Connection pool destroyed');
  }

  getMetrics(): PoolMetrics {
    return {
      ...this.metrics,
      totalConnections: this.idle.length + this.active.size,
      activeConnections: this.active.size,
      idleConnections: this.idle.length,
      waitingAcquires: this.waiting.length,
    };
  }

  private getIdleConnection(): PooledConnection<T> | null {
    while (this.idle.length > 0) {
      const conn = this.idle.pop()!;
      if (!this.isExpired(conn) && conn.isHealthy) {
        this.active.set(conn.id, conn);
        this.metrics.idleConnections = this.idle.length;
        this.metrics.activeConnections = this.active.size;
        return conn;
      }
      // Connection expired or unhealthy, destroy it
      this.destroyConnection(conn).catch(() => {});
    }
    return null;
  }

  private async createConnection(): Promise<void> {
    const conn = await this.factory.create();
    const pooled: PooledConnection<T> = {
      id: generateId(),
      connection: conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
      isHealthy: true,
    };
    this.active.set(pooled.id, pooled);
    this.metrics.connectionsCreated++;
    this.metrics.totalConnections = this.idle.length + this.active.size;
    this.metrics.activeConnections = this.active.size;
  }

  private async destroyConnection(conn: PooledConnection<T>): Promise<void> {
    try {
      await this.factory.destroy(conn.connection);
    } catch (err) {
      this.logger.warn('Error destroying connection', { error: (err as Error).message });
    }
    this.metrics.connectionsDestroyed++;
    this.metrics.totalConnections = this.idle.length + this.active.size;
    this.metrics.activeConnections = this.active.size;
  }

  private isExpired(conn: PooledConnection<T>): boolean {
    const now = Date.now();
    if (now - conn.createdAt > this.config.maxLifetimeMs) return true;
    if (now - conn.lastUsedAt > this.config.idleTimeoutMs) return true;
    return false;
  }

  private async waitForConnection(startTime: number): Promise<PooledConnection<T>> {
    this.metrics.waitingAcquires++;

    return new Promise<PooledConnection<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waiting.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waiting.splice(idx, 1);
        this.metrics.waitingAcquires--;
        this.metrics.totalErrors++;
        reject(new Error(`Acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      this.waiting.push({
        resolve: (conn) => {
          clearTimeout(timeout);
          this.metrics.waitingAcquires--;
          this.updateAcquireMetrics(startTime);
          resolve(conn);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.metrics.waitingAcquires--;
          reject(err);
        },
        timestamp: Date.now(),
      });
    });
  }

  private updateAcquireMetrics(startTime: number): void {
    const duration = Date.now() - startTime;
    const total = this.metrics.totalAcquires;
    this.metrics.avgAcquireTimeMs =
      (this.metrics.avgAcquireTimeMs * (total - 1) + duration) / total;
    if (duration > this.metrics.maxAcquireTimeMs) {
      this.metrics.maxAcquireTimeMs = duration;
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.runHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  private async runHealthCheck(): Promise<void> {
    const connections = [...this.idle];
    for (const conn of connections) {
      try {
        const isHealthy = await Promise.race([
          this.factory.validate(conn.connection),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeoutMs)
          ),
        ]);

        if (!isHealthy) {
          conn.isHealthy = false;
          this.metrics.healthCheckFailures++;
          this.logger.warn('Connection failed health check', { id: conn.id });
        }
      } catch {
        conn.isHealthy = false;
        this.metrics.healthCheckFailures++;
      }
    }

    // Clean up unhealthy idle connections
    this.idle = this.idle.filter((c) => c.isHealthy);
    this.metrics.idleConnections = this.idle.length;
  }
}
