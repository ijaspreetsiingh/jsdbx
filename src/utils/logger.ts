// =====================================================
// JSDB - Structured Logger
// =====================================================
import type { Logger, LogLevel } from '../types/index.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class JSDBLogger implements Logger {
  private level: number;
  private prefix: string;

  constructor(levelName: LogLevel = 'info', prefix = 'JSDB') {
    this.level = LOG_LEVELS[levelName] ?? LOG_LEVELS.info;
    this.prefix = prefix;
  }

  private format(level: string, message: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `[${ts}] [${this.prefix}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.debug) {
      // eslint-disable-next-line no-console
      console.debug(this.format('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.info) {
      // eslint-disable-next-line no-console
      console.info(this.format('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.warn) {
      // eslint-disable-next-line no-console
      console.warn(this.format('warn', message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.error) {
      // eslint-disable-next-line no-console
      console.error(this.format('error', message, meta));
    }
  }

  child(prefix: string): JSDBLogger {
    return new JSDBLogger(
      (Object.entries(LOG_LEVELS).find(([, v]) => v === this.level)?.[0] ?? 'info') as LogLevel,
      `${this.prefix}:${prefix}`
    );
  }

  setLevel(level: LogLevel): void {
    this.level = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  }
}

// Singleton logger (overrideable via config)
let globalLogger: Logger = new JSDBLogger('info');

export function getLogger(): Logger {
  return globalLogger;
}

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

export function createLogger(level: LogLevel = 'info', prefix = 'JSDB'): JSDBLogger {
  return new JSDBLogger(level, prefix);
}

// Silent logger for testing
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
