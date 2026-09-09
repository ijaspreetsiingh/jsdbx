// =====================================================
// jasdbx — JasAPI Middleware
// Database integration for JasAPI framework (native C++ engine)
// =====================================================
import { JSDBClient, createClient, createClientFromEnv } from '../client/client.js';
import type { JSDBConfig } from '../types/index.js';

export interface JasdbxJasapiOptions extends Partial<JSDBConfig> {
  /** Auto-connect on middleware initialization (default: true) */
  autoConnect?: boolean;
  /** Attach db to req (default: true) */
  attachToRequest?: boolean;
  /** Custom property name on req (default: 'db') */
  reqProperty?: string;
  /** Graceful shutdown on process exit (default: true) */
  gracefulShutdown?: boolean;
}

export interface JasdbxJasapiMiddleware {
  /** The JSDB client instance */
  client: JSDBClient;
  /** JasAPI middleware function */
  middleware: (req: any, res: any, next: () => void) => void;
  /** Connect to database */
  connect(): Promise<void>;
  /** Disconnect from database */
  disconnect(): Promise<void>;
}

/**
 * jasdbx JasAPI Middleware
 *
 * Usage:
 *   const jasdbx = require('jasdbx/jasapi');
 *   app.use(jasdbx({ database: 'postgresql', url: '...' }));
 *
 *   // In routes:
 *   app.get('/users', async (req, res) => {
 *     const users = await req.db.collection('users').find({});
 *     res.json(users);
 *   });
 */
export function jasdbxJasapi(options: JasdbxJasapiOptions = {}): JasdbxJasapiMiddleware {
  const {
    autoConnect = true,
    attachToRequest = true,
    reqProperty = 'db',
    gracefulShutdown = true,
    ...config
  } = options;

  // Create client from options or environment
  const client = Object.keys(config).length > 0
    ? createClient(config as JSDBConfig)
    : createClientFromEnv();

  // Middleware function (JasAPI compatible)
  const middleware = (req: any, res: any, next: () => void) => {
    // Attach db to request
    if (attachToRequest) {
      req[reqProperty] = client;
    }
    next();
  };

  // Connect function
  const connect = async () => {
    if (!client.isConnected()) {
      await client.connect();
    }
  };

  // Disconnect function
  const disconnect = async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  };

  // Auto-connect if enabled
  if (autoConnect) {
    connect().catch((err) => {
      console.error('[jasdbx] Auto-connect failed:', err.message);
    });
  }

  // Graceful shutdown
  if (gracefulShutdown) {
    const shutdown = async () => {
      await disconnect();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  return {
    client,
    middleware,
    connect,
    disconnect,
  };
}

/**
 * Factory function for simpler usage
 *
 * Usage:
 *   const { middleware, client } = jasdbx({ database: 'mysql', ... });
 *   app.use(middleware);
 */
export default jasdbxJasapi;
