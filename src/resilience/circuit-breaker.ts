// =====================================================
// JSDB v2.0 - Circuit Breaker & Retry Mechanism
// Prevents cascade failures, automatic recovery
// =====================================================
import { createLogger } from '../utils/logger.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  resetTimeoutMs: number;
  monitorIntervalMs: number;
  halfOpenMaxAttempts: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  averageResponseTimeMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private config: CircuitBreakerConfig;
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private responseTimes: number[] = [];
  private halfOpenAttempts = 0;
  private logger = createLogger('info', 'JSDB:CircuitBreaker');
  private name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 3,
      timeoutMs: config?.timeoutMs ?? 30000,
      resetTimeoutMs: config?.resetTimeoutMs ?? 60000,
      monitorIntervalMs: config?.monitorIntervalMs ?? 10000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - (this.lastFailureTime ?? 0) >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
        this.logger.info('Circuit breaker half-open', { name: this.name });
      } else {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
    }

    if (this.state === 'half-open') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        throw new Error(`Circuit breaker half-open limit reached for ${this.name}`);
      }
      this.halfOpenAttempts++;
    }

    this.totalRequests++;
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), this.config.timeoutMs)
        ),
      ]);

      const duration = Date.now() - startTime;
      this.recordSuccess(duration);
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.recordFailure(duration);
      throw err;
    }
  }

  private recordSuccess(duration: number): void {
    this.totalSuccesses++;
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
    this.responseTimes.push(duration);
    if (this.responseTimes.length > 100) this.responseTimes.shift();

    if (this.state === 'half-open') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.state = 'closed';
        this.failures = 0;
        this.consecutiveFailures = 0;
        this.logger.info('Circuit breaker closed (recovered)', { name: this.name });
      }
    }
  }

  private recordFailure(duration: number): void {
    this.totalFailures++;
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.responseTimes.push(duration);
    if (this.responseTimes.length > 100) this.responseTimes.shift();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.logger.warn('Circuit breaker reopened from half-open', { name: this.name });
    } else if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'open';
      this.logger.warn('Circuit breaker opened', {
        name: this.name,
        failures: this.consecutiveFailures,
      });
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    const avgResponseTime =
      this.responseTimes.length > 0
        ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
        : 0;

    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      averageResponseTimeMs: avgResponseTime,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenAttempts = 0;
  }
}

// Retry mechanism with exponential backoff
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  jitterEnabled: boolean;
}

export interface RetryStats {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  totalRetryTimeMs: number;
}

export class RetryMechanism {
  private config: RetryConfig;
  private logger = createLogger('info', 'JSDB:Retry');
  private stats: RetryStats = {
    totalAttempts: 0,
    successfulRetries: 0,
    failedRetries: 0,
    totalRetryTimeMs: 0,
  };

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 100,
      maxDelayMs: config?.maxDelayMs ?? 5000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      retryableErrors: config?.retryableErrors ?? [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'Connection lost',
        'Lock wait timeout',
      ],
      jitterEnabled: config?.jitterEnabled ?? true,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      this.stats.totalAttempts++;

      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;

        if (!this.isRetryable(err as Error) || attempt === this.config.maxRetries) {
          this.stats.failedRetries++;
          throw err;
        }

        const delay = this.calculateDelay(attempt);
        this.logger.warn('Retrying after error', {
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          error: (err as Error).message,
        });

        await this.sleep(delay);
        this.stats.totalRetryTimeMs += delay;
      }
    }

    this.stats.failedRetries++;
    throw lastError;
  }

  private isRetryable(err: Error): boolean {
    const message = err.message.toLowerCase();
    const code = (err as unknown as { code?: string }).code;
    return this.config.retryableErrors.some(
      (e) => message.includes(e.toLowerCase()) || code === e
    );
  }

  private calculateDelay(attempt: number): number {
    let delay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    delay = Math.min(delay, this.config.maxDelayMs);
    if (this.config.jitterEnabled) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats(): RetryStats {
    return { ...this.stats };
  }
}

// Combined resilience wrapper
export class ResilienceManager {
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private retryMechanism: RetryMechanism;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryMechanism = new RetryMechanism(retryConfig);
  }

  getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new CircuitBreaker(name, config));
    }
    return this.circuitBreakers.get(name)!;
  }

  getRetryMechanism(): RetryMechanism {
    return this.retryMechanism;
  }

  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    options?: { useCircuitBreaker?: boolean; useRetry?: boolean }
  ): Promise<T> {
    const useCB = options?.useCircuitBreaker ?? true;
    const useRetry = options?.useRetry ?? true;

    const executeFn = async (): Promise<T> => {
      if (useCB) {
        const cb = this.getCircuitBreaker(name);
        return cb.execute(fn);
      }
      return fn();
    };

    if (useRetry) {
      return this.retryMechanism.execute(executeFn);
    }
    return executeFn();
  }
}
