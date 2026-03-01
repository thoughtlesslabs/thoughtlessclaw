import type { ModelRef } from "../../agents/model-selection.js";

export type ProviderStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface ProviderHealth {
  provider: string;
  status: ProviderStatus;
  latencyMs: number;
  successRate: number;
  lastCheck: number;
  consecutiveFailures: number;
  totalRequests: number;
  failedRequests: number;
}

export interface ModelHealth {
  provider: string;
  model: string;
  status: ProviderStatus;
  latencyMs: number;
  contextWindow: number;
  pricePerMToken: number;
  lastUsed: number;
  failureCount: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30000,
  halfOpenMaxCalls: 3,
};

export class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = "closed";
        this.successCount = 0;
      }
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.state = "open";
      this.halfOpenCalls = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  canAttempt(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.config.timeoutMs) {
        this.state = "half-open";
        this.halfOpenCalls = 0;
        return true;
      }
      return false;
    }

    if (this.state === "half-open") {
      return this.halfOpenCalls < this.config.halfOpenMaxCalls;
    }

    return false;
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCalls = 0;
  }
}

export interface ProviderChain {
  primary: ModelRef;
  fallbacks: ModelRef[];
}

export interface FailoverConfig {
  maxRetries: number;
  retryDelayMs: number;
  circuitBreakerConfig: Partial<CircuitBreakerConfig>;
  healthCheckIntervalMs: number;
  latencyWarningThresholdMs: number;
}

export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  circuitBreakerConfig: {},
  healthCheckIntervalMs: 60000,
  latencyWarningThresholdMs: 5000,
};

export class ProviderFailoverManager {
  private providers = new Map<string, ProviderHealth>();
  private models = new Map<string, ModelHealth>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private chains = new Map<string, ProviderChain>();
  private config: FailoverConfig;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<FailoverConfig> = {}) {
    this.config = { ...DEFAULT_FAILOVER_CONFIG, ...config };
  }

  registerProvider(provider: string): void {
    if (!this.providers.has(provider)) {
      this.providers.set(provider, {
        provider,
        status: "unknown",
        latencyMs: 0,
        successRate: 1.0,
        lastCheck: 0,
        consecutiveFailures: 0,
        totalRequests: 0,
        failedRequests: 0,
      });
    }

    if (!this.circuitBreakers.has(provider)) {
      this.circuitBreakers.set(provider, new CircuitBreaker(this.config.circuitBreakerConfig));
    }
  }

  registerModel(
    provider: string,
    model: string,
    contextWindow: number,
    pricePerMToken: number,
  ): void {
    const key = `${provider}/${model}`;
    if (!this.models.has(key)) {
      this.models.set(key, {
        provider,
        model,
        status: "unknown",
        latencyMs: 0,
        contextWindow,
        pricePerMToken,
        lastUsed: 0,
        failureCount: 0,
      });
    }
  }

  setFailoverChain(taskType: string, chain: ProviderChain): void {
    this.chains.set(taskType, chain);
    for (const ref of [chain.primary, ...chain.fallbacks]) {
      this.registerProvider(ref.provider);
      this.registerModel(ref.provider, ref.model, 128000, 0);
    }
  }

  async selectProvider(taskType: string, estimatedTokens?: number): Promise<ModelRef | null> {
    const chain = this.chains.get(taskType);
    if (!chain) {
      return null;
    }

    const candidates = [chain.primary, ...chain.fallbacks];

    for (const ref of candidates) {
      const breaker = this.circuitBreakers.get(ref.provider);
      if (breaker && !breaker.canAttempt()) {
        continue;
      }

      const health = this.providers.get(ref.provider);
      if (health && health.status === "unhealthy") {
        continue;
      }

      if (estimatedTokens) {
        const modelHealth = this.models.get(`${ref.provider}/${ref.model}`);
        if (modelHealth && modelHealth.contextWindow < estimatedTokens) {
          continue;
        }
      }

      return ref;
    }

    return chain.primary;
  }

  recordSuccess(provider: string, model: string, latencyMs: number): void {
    const key = `${provider}/${model}`;

    const providerHealth = this.providers.get(provider);
    if (providerHealth) {
      providerHealth.totalRequests++;
      providerHealth.latencyMs = providerHealth.latencyMs * 0.9 + latencyMs * 0.1;
      providerHealth.consecutiveFailures = 0;
      if (providerHealth.status === "degraded") {
        providerHealth.status = "healthy";
      }
    }

    const breaker = this.circuitBreakers.get(provider);
    if (breaker) {
      breaker.recordSuccess();
    }

    const modelHealth = this.models.get(key);
    if (modelHealth) {
      modelHealth.lastUsed = Date.now();
      modelHealth.latencyMs = modelHealth.latencyMs * 0.9 + latencyMs * 0.1;
      modelHealth.failureCount = 0;
    }
  }

  recordFailure(provider: string, model: string, _error?: string): void {
    const key = `${provider}/${model}`;

    const providerHealth = this.providers.get(provider);
    if (providerHealth) {
      providerHealth.totalRequests++;
      providerHealth.failedRequests++;
      providerHealth.consecutiveFailures++;
      providerHealth.successRate = 1 - providerHealth.failedRequests / providerHealth.totalRequests;

      if (providerHealth.consecutiveFailures >= 3) {
        providerHealth.status = "unhealthy";
      } else if (providerHealth.consecutiveFailures >= 1) {
        providerHealth.status = "degraded";
      }
    }

    const breaker = this.circuitBreakers.get(provider);
    if (breaker) {
      breaker.recordFailure();
    }

    const modelHealth = this.models.get(key);
    if (modelHealth) {
      modelHealth.failureCount++;
    }
  }

  getProviderHealth(provider: string): ProviderHealth | undefined {
    return this.providers.get(provider);
  }

  getModelHealth(provider: string, model: string): ModelHealth | undefined {
    return this.models.get(`${provider}/${model}`);
  }

  getAllProvidersHealth(): ProviderHealth[] {
    return Array.from(this.providers.values());
  }

  getBestModelByLatency(provider: string): ModelHealth | null {
    const candidates = Array.from(this.models.values())
      .filter((m) => m.provider === provider && m.status !== "unhealthy")
      .toSorted((a, b) => a.latencyMs - b.latencyMs);
    return candidates[0] || null;
  }

  getCheapestModel(provider: string): ModelHealth | null {
    const candidates = Array.from(this.models.values())
      .filter((m) => m.provider === provider && m.status !== "unhealthy")
      .toSorted((a, b) => a.pricePerMToken - b.pricePerMToken);
    return candidates[0] || null;
  }

  shouldFailover(provider: string): boolean {
    const health = this.providers.get(provider);
    if (!health) {
      return true;
    }
    return health.status === "unhealthy" || health.consecutiveFailures >= 3;
  }

  async executeWithFailover<T>(
    taskType: string,
    estimatedTokens: number,
    executor: (ref: ModelRef) => Promise<T>,
    onFallback?: (from: ModelRef, to: ModelRef, error: Error) => void,
  ): Promise<T> {
    const ref = await this.selectProvider(taskType, estimatedTokens);
    if (!ref) {
      throw new Error(`No available provider for task type: ${taskType}`);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const currentRef = await this.selectProvider(taskType, estimatedTokens);
      if (!currentRef) {
        throw new Error(`No available provider after ${attempt} attempts`);
      }

      const startTime = Date.now();

      try {
        const result = await executor(currentRef);
        const latencyMs = Date.now() - startTime;
        this.recordSuccess(currentRef.provider, currentRef.model, latencyMs);
        return result;
      } catch (err) {
        lastError = err as Error;
        this.recordFailure(currentRef.provider, currentRef.model, lastError.message);

        if (attempt > 0 && onFallback) {
          onFallback(ref, currentRef, lastError);
        }

        if (this.shouldFailover(currentRef.provider)) {
          await this.sleep(this.config.retryDelayMs * attempt);
        }
      }
    }

    throw lastError || new Error(`All retries exhausted for task type: ${taskType}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStatus(): {
    providers: ProviderHealth[];
    chains: Record<string, ProviderChain>;
  } {
    return {
      providers: this.getAllProvidersHealth(),
      chains: Object.fromEntries(this.chains),
    };
  }

  reset(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
    for (const health of this.providers.values()) {
      health.status = "unknown";
      health.consecutiveFailures = 0;
    }
  }
}

export function createFailoverManager(config?: Partial<FailoverConfig>): ProviderFailoverManager {
  return new ProviderFailoverManager(config);
}
