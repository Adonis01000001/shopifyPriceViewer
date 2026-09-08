import { ENV } from "../_core/env";
import { logger } from "../_core/logger";

export type SerpApiFailureCategory =
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "network_error"
  | "authentication_error"
  | "other_4xx"
  | "server_error"
  | "provider_error";

export interface SerpApiLocale {
  gl: string;
  hl: string;
  googleDomain: string;
}

export interface SerpApiSearchParams {
  query: string;
  locale: SerpApiLocale;
}

export interface SerpApiSearchResult {
  organicResults: unknown[];
  cacheHit: boolean;
  deduplicated: boolean;
  attempts: number;
}

export interface SerpApiFailureDiagnostic {
  provider: "serpapi";
  category: SerpApiFailureCategory;
  status?: number;
  message: string;
  retryable: boolean;
  attempts: number;
}

export interface SerpApiMetrics {
  requestsAttempted: number;
  successfulRequests: number;
  rateLimited: number;
  quotaExhausted: number;
  quotaFailFast: number;
  timeouts: number;
  networkErrors: number;
  authenticationErrors: number;
  other4xx: number;
  serverErrors: number;
  providerErrors: number;
  retries: number;
  backoffMs: number;
  cacheHits: number;
  deduplicated: number;
}

interface CacheEntry {
  expiresAt: number;
  organicResults: unknown[];
}

interface SerpApiFailureOptions {
  category: SerpApiFailureCategory;
  message: string;
  status?: number;
  retryAfterMs?: number;
  attempts?: number;
  retryable?: boolean;
}

export class SerpApiRequestError extends Error {
  readonly provider = "serpapi";
  readonly category: SerpApiFailureCategory;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly attempts: number;
  readonly retryable: boolean;

  constructor(options: SerpApiFailureOptions) {
    super(options.message);
    this.name = "SerpApiRequestError";
    this.category = options.category;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.attempts = options.attempts ?? 0;
    this.retryable = options.retryable ?? false;
  }

  toDiagnostic(): SerpApiFailureDiagnostic {
    return {
      provider: this.provider,
      category: this.category,
      status: this.status,
      message: this.message,
      retryable: this.retryable,
      attempts: this.attempts,
    };
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const requestTimeoutMs = 45_000;
const semaphore = new Semaphore(ENV.serpApiMaxConcurrency);
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SerpApiSearchResult>>();
let quotaUnavailableUntil = 0;

const metrics: SerpApiMetrics = {
  requestsAttempted: 0,
  successfulRequests: 0,
  rateLimited: 0,
  quotaExhausted: 0,
  quotaFailFast: 0,
  timeouts: 0,
  networkErrors: 0,
  authenticationErrors: 0,
  other4xx: 0,
  serverErrors: 0,
  providerErrors: 0,
  retries: 0,
  backoffMs: 0,
  cacheHits: 0,
  deduplicated: 0,
};

function incrementFailureMetric(category: SerpApiFailureCategory): void {
  switch (category) {
    case "rate_limited":
      metrics.rateLimited++;
      break;
    case "quota_exhausted":
      metrics.quotaExhausted++;
      break;
    case "timeout":
      metrics.timeouts++;
      break;
    case "network_error":
      metrics.networkErrors++;
      break;
    case "authentication_error":
      metrics.authenticationErrors++;
      break;
    case "other_4xx":
      metrics.other4xx++;
      break;
    case "server_error":
      metrics.serverErrors++;
      break;
    case "provider_error":
      metrics.providerErrors++;
      break;
  }
}

function redactedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api_key|key|token)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 300);
  return ENV.serpApiKey ? redacted.split(ENV.serpApiKey).join("[redacted]") : redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerMessage(payload: Record<string, unknown>, body: string): string {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error != null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "SerpApi returned an error payload";
    }
  }
  return body.trim() || "SerpApi returned an error response";
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey({ query, locale }: SerpApiSearchParams): string {
  return [
    normalizeSearchQuery(query),
    locale.gl.toLowerCase(),
    locale.hl.toLowerCase(),
    locale.googleDomain.toLowerCase(),
  ].join("|");
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

export function classifySerpApiFailure(
  status: number | undefined,
  message: string
): SerpApiFailureCategory {
  const text = message.toLowerCase();
  const quotaSignal =
    /quota|out of searches|run out of searches|no\s+searches|searches?\s+(?:left|limit|exhausted|remaining)|insufficient credits|credit limit|plan limit|monthly limit|daily limit|exhausted/.test(
      text
    );

  if (status === 401 || /invalid api key|authentication/.test(text)) {
    return "authentication_error";
  }
  if (quotaSignal) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 403) return "authentication_error";
  if (status != null && status >= 500) return "server_error";
  if (status != null && status >= 400) return "other_4xx";
  return "provider_error";
}

export function computeRetryDelayMs(
  attempt: number,
  retryAfterMs?: number,
  random = Math.random()
): number {
  const boundedRetryAfter =
    retryAfterMs == null
      ? undefined
      : Math.min(ENV.serpApiMaxBackoffMs, Math.max(0, retryAfterMs));
  if (boundedRetryAfter != null) return Math.round(boundedRetryAfter);

  const exponential = Math.min(
    ENV.serpApiMaxBackoffMs,
    ENV.serpApiBaseBackoffMs * Math.pow(2, attempt)
  );
  return Math.round(Math.max(0, Math.min(1, random)) * exponential);
}

function isRetryable(category: SerpApiFailureCategory): boolean {
  return (
    category === "rate_limited" ||
    category === "server_error" ||
    category === "timeout" ||
    category === "network_error"
  );
}

function recordFailure(category: SerpApiFailureCategory): void {
  incrementFailureMetric(category);
}

async function requestOnce(params: SerpApiSearchParams): Promise<unknown[]> {
  if (!ENV.serpApiKey) {
    throw new SerpApiRequestError({
      category: "authentication_error",
      message: "SerpApi API key is not configured",
    });
  }

  const url =
    "https://serpapi.com/search.json?" +
    new URLSearchParams({
      engine: "google",
      q: params.query,
      gl: params.locale.gl,
      hl: params.locale.hl,
      google_domain: params.locale.googleDomain,
      num: "20",
      api_key: ENV.serpApiKey,
    }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    const isTimeout =
      (error instanceof DOMException && error.name === "TimeoutError") ||
      (error instanceof Error && error.name === "TimeoutError");
    const category = isTimeout ? "timeout" : "network_error";
    throw new SerpApiRequestError({
      category,
      message: redactedMessage(error),
    });
  }

  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch (error) {
    throw new SerpApiRequestError({
      category: "network_error",
      status: response.status,
      message: `SerpApi response body could not be read: ${redactedMessage(error)}`,
    });
  }
  const body = rawBody.slice(0, 10_000);
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    const message = redactedMessage(body);
    const category = classifySerpApiFailure(response.status, message);
    throw new SerpApiRequestError({
      category,
      status: response.status,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      message: `SerpApi returned malformed JSON${message ? `: ${message}` : ""}`,
    });
  }

  if (!isRecord(payload)) {
    throw new SerpApiRequestError({
      category: "provider_error",
      status: response.status,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      message: "SerpApi returned an unexpected response shape",
    });
  }

  const message = providerMessage(payload, body);
  if (!response.ok || payload.error != null) {
    const category = classifySerpApiFailure(response.status, message);
    throw new SerpApiRequestError({
      category,
      status: response.status,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      message: `SerpApi request failed (${category}): ${redactedMessage(message)}`,
    });
  }

  const organicResults = payload.organic_results;
  if (!Object.prototype.hasOwnProperty.call(payload, "organic_results")) {
    throw new SerpApiRequestError({
      category: "provider_error",
      status: response.status,
      message: "SerpApi response is missing organic_results",
    });
  }
  if (
    !Array.isArray(organicResults) ||
    organicResults.some(result => !isRecord(result))
  ) {
    throw new SerpApiRequestError({
      category: "provider_error",
      status: response.status,
      message: "SerpApi response contains invalid organic_results",
    });
  }
  return organicResults;
}

async function executeSearch(
  params: SerpApiSearchParams,
  key: string
): Promise<SerpApiSearchResult> {
  return semaphore.run(async () => {
    const unavailableUntil = quotaUnavailableUntil;
    if (unavailableUntil > Date.now()) {
      metrics.quotaFailFast++;
      throw new SerpApiRequestError({
        category: "quota_exhausted",
        status: 429,
        message: "SerpApi account quota is temporarily unavailable",
        attempts: 0,
        retryable: false,
      });
    }

    let attempts = 0;
    for (;;) {
      attempts++;
      metrics.requestsAttempted++;
      try {
        const organicResults = await requestOnce(params);
        metrics.successfulRequests++;
        if (ENV.serpApiCacheTtlMs > 0) {
          cache.set(key, {
            organicResults,
            expiresAt: Date.now() + ENV.serpApiCacheTtlMs,
          });
        }
        return {
          organicResults,
          cacheHit: false,
          deduplicated: false,
          attempts,
        };
      } catch (error) {
        const failure =
          error instanceof SerpApiRequestError
            ? error
            : new SerpApiRequestError({
                category: "provider_error",
                message: redactedMessage(error),
                retryable: false,
              });
        recordFailure(failure.category);

        if (failure.category === "quota_exhausted") {
          quotaUnavailableUntil = Date.now() + ENV.serpApiQuotaCooldownMs;
          logger.error(
            {
              category: failure.category,
              unavailableUntil: new Date(quotaUnavailableUntil).toISOString(),
              action: "fail_fast_until_cooldown",
            },
            "SerpApi account quota exhausted"
          );
          throw new SerpApiRequestError({
            category: failure.category,
            status: failure.status,
            retryAfterMs: failure.retryAfterMs,
            message: failure.message,
            attempts,
            retryable: false,
          });
        }

        if (
          !isRetryable(failure.category) ||
          attempts > ENV.serpApiMaxRetries
        ) {
          logger.warn(
            {
              category: failure.category,
              status: failure.status,
              attempts,
              message: failure.message,
            },
            "SerpApi request exhausted retries"
          );
          throw new SerpApiRequestError({
            category: failure.category,
            status: failure.status,
            retryAfterMs: failure.retryAfterMs,
            message: failure.message,
            attempts,
            retryable: isRetryable(failure.category),
          });
        }

        const waitMs = computeRetryDelayMs(
          attempts - 1,
          failure.category === "rate_limited" ? failure.retryAfterMs : undefined
        );
        metrics.retries++;
        metrics.backoffMs += waitMs;
        logger.warn(
          {
            category: failure.category,
            status: failure.status,
            attempt: attempts,
            waitMs,
            action: "retrying_with_backoff",
          },
          "SerpApi request will retry"
        );
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  });
}

export const serpApiService = {
  async search(params: SerpApiSearchParams): Promise<SerpApiSearchResult> {
    const key = cacheKey(params);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      metrics.cacheHits++;
      return {
        organicResults: cached.organicResults,
        cacheHit: true,
        deduplicated: false,
        attempts: 0,
      };
    }
    if (cached) cache.delete(key);

    const existing = inFlight.get(key);
    if (existing) {
      metrics.deduplicated++;
      const result = await existing;
      return { ...result, deduplicated: true };
    }

    const request = executeSearch(params, key);
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  },

  getMetrics(): SerpApiMetrics {
    return { ...metrics };
  },
};

export function resetSerpApiRuntimeStateForTests(): void {
  cache.clear();
  inFlight.clear();
  quotaUnavailableUntil = 0;
  Object.keys(metrics).forEach(key => {
    metrics[key as keyof SerpApiMetrics] = 0;
  });
}
