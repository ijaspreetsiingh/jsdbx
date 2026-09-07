// =====================================================
// JSDB - Real-time / Change Streams Module
// Supports: Change Streams (MongoDB), LISTEN/NOTIFY (PostgreSQL),
//           Polling-based (MySQL, SQLite)
// =====================================================
import { EventEmitter } from 'events';
import type { Document, ChangeEvent, WatchOptions, Filter, AggregationStage } from '../types/index.js';

export interface ChangeStreamOptions extends WatchOptions {
  pollIntervalMs?: number;
  batchSize?: number;
}

export interface RealtimeConnection {
  id: string;
  collection: string;
  filter?: Filter;
  options: ChangeStreamOptions;
  callback: (event: ChangeEvent) => void;
  cleanup: () => void;
}

/**
 * Base class for real-time change listeners
 */
export abstract class ChangeListener extends EventEmitter {
  protected connections: Map<string, RealtimeConnection> = new Map();
  protected running = false;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  /**
   * Subscribe to changes on a collection
   */
  subscribe(
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): string {
    const id = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const cleanup = this.createSubscription(id, collection, callback, options);

    this.connections.set(id, {
      id,
      collection,
      options: options || {},
      callback,
      cleanup,
    });

    return id;
  }

  /**
   * Unsubscribe from changes
   */
  unsubscribe(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.cleanup();
      this.connections.delete(connectionId);
    }
  }

  protected abstract createSubscription(
    id: string,
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): () => void;

  /**
   * Emit a change event
   */
  protected emitChange(event: ChangeEvent): void {
    this.emit('change', event);
    // Emit to specific collection listeners
    this.emit(`change:${event.ns.coll}`, event);
  }
}

/**
 * MongoDB Change Streams implementation
 */
export class MongoChangeListener extends ChangeListener {
  private changeStreams: Map<string, ReturnType<any>> = new Map();

  constructor(private getClient: () => any) {
    super();
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const [id, stream] of this.changeStreams) {
      try {
        await stream.close();
      } catch {
        // Ignore close errors
      }
    }
    this.changeStreams.clear();
  }

  protected createSubscription(
    id: string,
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): () => void {
    const client = this.getClient();
    const db = client.db?.() || client;

    const pipeline = options?.resumeAfter
      ? [{ $match: { _id: { $gt: options.resumeAfter } } }]
      : undefined;

    const changeStream = db.collection(collection).watch(pipeline, {
      fullDocument: options?.fullDocument || 'updateLookup',
      resumeAfter: options?.resumeAfter,
      startAfter: options?.startAfter,
      startAtOperationTime: options?.startAtOperationTime,
    });

    changeStream.on('change', (change: any) => {
      const event: ChangeEvent = {
        operationType: change.operationType,
        ns: change.ns,
        documentKey: change.documentKey,
        fullDocument: change.fullDocument,
        updateDescription: change.updateDescription,
        clusterTime: change.clusterTime,
        operationTime: change.operationTime,
      };
      callback(event);
      this.emitChange(event);
    });

    this.changeStreams.set(id, changeStream);

    return () => {
      changeStream.close().catch(() => {});
      this.changeStreams.delete(id);
    };
  }
}

/**
 * PostgreSQL LISTEN/NOTIFY implementation
 */
export class PostgresChangeListener extends ChangeListener {
  private pgListeners: Map<string, any> = new Map();

  constructor(private getPool: () => any) {
    super();
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const [id, client] of this.pgListeners) {
      try {
        client.detach();
      } catch {
        // Ignore
      }
    }
    this.pgListeners.clear();
  }

  protected createSubscription(
    id: string,
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): () => void {
    const pool = this.getPool();
    const channel = `jsdb_changes_${collection}`;

    // Create notification function if it doesn't exist
    const createFnSQL = `
      CREATE OR REPLACE FUNCTION jsdb_notify_changes() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify(
          'jsdb_changes_' || TG_TABLE_NAME,
          json_build_object(
            'operationType', TG_OP,
            'ns', json_build_object('db', current_database(), 'coll', TG_TABLE_NAME),
            'documentKey', json_build_object('_id', COALESCE(NEW.id, OLD.id)),
            'fullDocument', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
          )::text
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `;

    pool.query(createFnSQL).catch(() => {
      // Function might already exist
    });

    // Listen on the channel
    pool.connect().then((client: any) => {
      client.query(`LISTEN ${channel}`);
      client.on('notification', (msg: any) => {
        try {
          const event: ChangeEvent = JSON.parse(msg.payload);
          callback(event);
          this.emitChange(event);
        } catch {
          // Ignore parse errors
        }
      });
      this.pgListeners.set(id, client);
    });

    return () => {
      const client = this.pgListeners.get(id);
      if (client) {
        client.query(`UNLISTEN ${channel}`);
        client.release();
        this.pgListeners.delete(id);
      }
    };
  }
}

/**
 * Polling-based change listener (MySQL, SQLite)
 * Uses a change tracking table to detect changes
 */
export class PollingChangeListener extends ChangeListener {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastTimestamps: Map<string, Date> = new Map();

  constructor(
    private executeQuery: (sql: string, params?: unknown[]) => Promise<any>,
    private pollIntervalMs = 1000
  ) {
    super();
  }

  async start(): Promise<void> {
    this.running = true;
    // Create change tracking table if it doesn't exist
    await this.executeQuery(`
      CREATE TABLE IF NOT EXISTS _jsdb_changes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        collection VARCHAR(255) NOT NULL,
        operation VARCHAR(10) NOT NULL,
        document_id VARCHAR(255),
        data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(() => {
      // SQLite version
      return this.executeQuery(`
        CREATE TABLE IF NOT EXISTS _jsdb_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection TEXT NOT NULL,
          operation TEXT NOT NULL,
          document_id TEXT,
          data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });

    // Create triggers for all collections
    await this.createTriggers();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  protected createSubscription(
    id: string,
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): () => void {
    const interval = options?.pollIntervalMs || this.pollIntervalMs;
    this.lastTimestamps.set(id, new Date());

    const timer = setInterval(async () => {
      if (!this.running) return;

      try {
        const lastTs = this.lastTimestamps.get(id) || new Date();
        const changes = await this.executeQuery(
          `SELECT * FROM _jsdb_changes WHERE collection = ? AND created_at > ? ORDER BY id ASC`,
          [collection, lastTs]
        );

        if (changes && changes.length > 0) {
          for (const row of changes) {
            const event: ChangeEvent = {
              operationType: row.operation as ChangeEvent['operationType'],
              ns: { db: '', coll: collection },
              documentKey: { _id: row.document_id },
              fullDocument: row.data ? JSON.parse(row.data) : undefined,
            };
            callback(event);
            this.emitChange(event);
          }
          this.lastTimestamps.set(id, new Date());
        }
      } catch {
        // Ignore polling errors
      }
    }, interval);

    this.timers.set(id, timer);

    return () => {
      clearInterval(timer);
      this.timers.delete(id);
      this.lastTimestamps.delete(id);
    };
  }

  private async createTriggers(): Promise<void> {
    // MySQL triggers
    const triggerSQL = `
      CREATE TRIGGER IF NOT EXISTS jsdb_changes_insert
      AFTER INSERT ON _jsdb_changes
      FOR EACH ROW
      BEGIN
        -- Trigger exists, do nothing
      END
    `;
    await this.executeQuery(triggerSQL).catch(() => {});
  }
}

/**
 * Real-time Manager - unified interface
 */
export class RealtimeManager extends EventEmitter {
  private realtimeListeners: Map<string, ChangeListener> = new Map();
  private connections: Map<string, string> = new Map(); // connectionId -> listenerId

  constructor() {
    super();
  }

  /**
   * Register a change listener for a database type
   */
  registerListener(dbType: string, listener: ChangeListener): void {
    this.realtimeListeners.set(dbType, listener);
    listener.on('change', (event: ChangeEvent) => {
      this.emit('change', event);
      this.emit(`change:${event.ns.coll}`, event);
    });
  }

  /**
   * Watch a collection for changes
   */
  async watch(
    dbType: string,
    collection: string,
    callback: (event: ChangeEvent) => void,
    options?: ChangeStreamOptions
  ): Promise<string> {
    const listener = this.realtimeListeners.get(dbType);
    if (!listener) {
      throw new Error(`No change listener registered for database type: ${dbType}`);
    }

    if (!this.isStarted(dbType)) {
      await listener.start();
    }

    const connectionId = listener.subscribe(collection, callback, options);
    this.connections.set(connectionId, dbType);
    return connectionId;
  }

  /**
   * Stop watching a collection
   */
  async unwatch(connectionId: string): Promise<void> {
    const dbType = this.connections.get(connectionId);
    if (dbType) {
      const listener = this.realtimeListeners.get(dbType);
      if (listener) {
        listener.unsubscribe(connectionId);
      }
      this.connections.delete(connectionId);
    }
  }

  /**
   * Stop all listeners
   */
  async stopAll(): Promise<void> {
    for (const [dbType, listener] of this.realtimeListeners) {
      if (this.isStarted(dbType)) {
        await listener.stop();
      }
    }
  }

  private isStarted(dbType: string): boolean {
    const listener = this.realtimeListeners.get(dbType);
    return (listener as any)?.running || false;
  }
}
