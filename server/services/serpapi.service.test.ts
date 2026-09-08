import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import {
  classifySerpApiFailure,
  computeRetryDelayMs,
  parseRetryAfterMs,
  resetSerpApiRuntimeStateForTests,
  SerpApiRequestError,
  serpApiService,
} from "./serpapi.service";

const original = {
  serpApiKey: ENV.serpApiKey,
  serpApiMaxRetries: ENV.serpApiMaxRetries,
  serpApiBaseBackoffMs: ENV.serpApiBaseBackoffMs,
  serpApiMaxBackoffMs: ENV.serpApiMaxBackoffMs,
  serpApiCacheTtlMs: ENV.serpApiCacheTtlMs,
  serpApiQuotaCooldownMs: ENV.serpApiQuotaCooldownMs,
};

function success(
  results: unknown[] = [{ link: "https://shop.example/product" }]
) {
  return new Response(JSON.stringify({ organic_results: results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function params(query: string) {
  return {
    query,
    locale: { gl: "us", hl: "en", googleDomain: "google.com" },
  };
}

describe("shared SerpApi request scheduler", () => {
  beforeEach(() => {
    resetSerpApiRuntimeStateForTests();
    ENV.serpApiKey = "test-serp-key";
    ENV.serpApiMaxRetries = 2;
    ENV.serpApiBaseBackoffMs = 0;
    ENV.serpApiMaxBackoffMs = 1000;
    ENV.serpApiCacheTtlMs = 60_000;
    ENV.serpApiQuotaCooldownMs = 60_000;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(ENV, original);
    vi.unstubAllGlobals();
  });

  it("returns successful organic results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal("fetch", fetchMock);

    const result = await serpApiService.search(params("Anker 737 price"));

    expect(result.organicResults).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(serpApiService.getMetrics()).toMatchObject({
      requestsAttempted: 1,
      successfulRequests: 1,
    });
  });

  it("preserves a provider error returned in an HTTP 200 payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid engine parameter" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      serpApiService.search(params("provider error payload"))
    ).rejects.toMatchObject({
      category: "provider_error",
      provider: "serpapi",
      status: 200,
      attempts: 1,
      retryable: false,
      message: expect.stringContaining("Invalid engine parameter"),
    });
  });

  it("rejects a successful response with missing or invalid organic results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organic_results: [null] }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      serpApiService.search(params("missing organic results"))
    ).rejects.toMatchObject({
      category: "provider_error",
      message: expect.stringContaining("missing organic_results"),
    });
    await expect(
      serpApiService.search(params("invalid organic results"))
    ).rejects.toMatchObject({
      category: "provider_error",
      message: expect.stringContaining("invalid organic_results"),
    });
  });

  it("keeps an explicit empty organic result list as a valid zero-result search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await serpApiService.search(params("valid zero results"));

    expect(result.organicResults).toEqual([]);
    expect(result.cacheHit).toBe(false);
    expect(serpApiService.getMetrics()).toMatchObject({
      successfulRequests: 1,
      providerErrors: 0,
    });
  });

  it("parses complete large provider responses instead of parsing a diagnostic slice", async () => {
    const results = Array.from({ length: 20 }, (_, index) => ({
      link: `https://shop-${index}.example/product`,
      title: `Result ${index} ${"details ".repeat(120)}`,
    }));
    const response = success(results);
    const responseBody = JSON.stringify({ organic_results: results });
    expect(responseBody.length).toBeGreaterThan(10_000);
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await serpApiService.search(params("large valid response"));

    expect(result.organicResults).toHaveLength(20);
  });

  it("classifies server, timeout, and network failures distinctly", async () => {
    ENV.serpApiMaxRetries = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }))
      .mockRejectedValueOnce(
        Object.assign(new Error("request timed out"), {
          name: "TimeoutError",
        })
      )
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND serpapi.com"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(serpApiService.search(params("server failure"))).rejects.toMatchObject({
      category: "server_error",
      attempts: 1,
    });
    await expect(serpApiService.search(params("timeout failure"))).rejects.toMatchObject({
      category: "timeout",
      attempts: 1,
    });
    await expect(serpApiService.search(params("network failure"))).rejects.toMatchObject({
      category: "network_error",
      attempts: 1,
    });
  });

  it("classifies quota exhaustion from a provider payload and does not retry it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Your account quota is exhausted" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await serpApiService
      .search(params("quota payload"))
      .catch(value => value as SerpApiRequestError);

    expect(error).toMatchObject({
      category: "quota_exhausted",
      attempts: 1,
      retryable: false,
      message: expect.stringContaining("Your account quota is exhausted"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 using Retry-After and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary rate limit", {
          status: 429,
          headers: { "retry-after": "0" },
        })
      )
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetchMock);

    await serpApiService.search(params("Anker 737 price"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(serpApiService.getMetrics()).toMatchObject({
      rateLimited: 1,
      retries: 1,
    });
  });

  it("stops after the bounded retry count for repeated 429s", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response("requests per minute exceeded", { status: 429 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      serpApiService.search(params("repeated rate limit"))
    ).rejects.toMatchObject({ category: "rate_limited" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(serpApiService.getMetrics()).toMatchObject({
      rateLimited: 3,
      retries: 2,
    });
  });

  it("classifies quota exhaustion and fails subsequent requests fast", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("Your account has run out of searches", { status: 429 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      serpApiService.search(params("quota query"))
    ).rejects.toMatchObject({ category: "quota_exhausted" });
    await expect(
      serpApiService.search(params("different quota query"))
    ).rejects.toMatchObject({ category: "quota_exhausted" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(serpApiService.getMetrics().quotaFailFast).toBe(1);
  });

  it("coalesces duplicate in-flight requests and serves later cache hits", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>(resolve => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(responsePromise);
    vi.stubGlobal("fetch", fetchMock);

    const first = serpApiService.search(params("same normalized query"));
    const second = serpApiService.search(
      params("  SAME   normalized   QUERY ")
    );
    resolveResponse?.(success());
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const cachedResult = await serpApiService.search(
      params("same normalized query")
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.deduplicated).toBe(false);
    expect(secondResult.deduplicated).toBe(true);
    expect(cachedResult.cacheHit).toBe(true);
    expect(serpApiService.getMetrics()).toMatchObject({
      deduplicated: 1,
      cacheHits: 1,
    });
  });

  it("limits concurrent upstream requests through the shared scheduler", async () => {
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return success();
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all(
      ["one", "two", "three"].map(query => serpApiService.search(params(query)))
    );

    expect(maximum).toBeLessThanOrEqual(ENV.serpApiMaxConcurrency);
  });

  it("supports Retry-After parsing and jittered exponential backoff", () => {
    ENV.serpApiBaseBackoffMs = 100;
    ENV.serpApiMaxBackoffMs = 1000;
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(computeRetryDelayMs(0, undefined, 0.5)).toBe(50);
    expect(computeRetryDelayMs(1, undefined, 0.5)).toBe(100);
    expect(computeRetryDelayMs(0, 2000)).toBe(1000);
    expect(classifySerpApiFailure(429, "requests per minute exceeded")).toBe(
      "rate_limited"
    );
    expect(classifySerpApiFailure(429, "monthly quota exhausted")).toBe(
      "quota_exhausted"
    );
  });

  it("does not expose the API key in thrown errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("invalid api key test-serp-key", { status: 401 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = await serpApiService
      .search(params("auth error"))
      .catch(value => value as SerpApiRequestError);
    expect(error).toBeInstanceOf(SerpApiRequestError);
    expect(error.message).not.toContain("test-serp-key");
  });
});
