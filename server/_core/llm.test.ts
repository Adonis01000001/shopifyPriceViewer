import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import {
  AllLLMModelsFailedError,
  LLMRequestError,
  LLMValidationError,
  classifyLLMFailure,
  getModelState,
  invokeLLM,
  invokeLLMWithFallback,
  resetLLMRuntimeStateForTests,
} from "./llm";

const original = {
  openaiApiKey: ENV.openaiApiKey,
  openaiModel: ENV.openaiModel,
  openaiModels: ENV.openaiModels,
  openrouterApiKey: ENV.openrouterApiKey,
  openrouterModels: ENV.openrouterModels,
  openrouterModel: ENV.openrouterModel,
  llmMaxRetries: ENV.llmMaxRetries,
  llmBackoffBaseMs: ENV.llmBackoffBaseMs,
};

function success(model: string) {
  return new Response(
    JSON.stringify({
      id: `result-${model}`,
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "{}" },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function requestModel(call: unknown[]): string {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)).model;
}

describe("quota-aware LLM model manager", () => {
  beforeEach(() => {
    resetLLMRuntimeStateForTests();
    ENV.openaiApiKey = "";
    ENV.openaiModel = "gpt-5.6-luna";
    ENV.openaiModels = [];
    ENV.openrouterApiKey = "test-key";
    ENV.openrouterModel = "model-a";
    ENV.openrouterModels = ["model-a", "model-b"];
    ENV.llmMaxRetries = 2;
    ENV.llmBackoffBaseMs = 0;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(ENV, original);
    vi.unstubAllGlobals();
  });

  it("classifies daily quota signals independently from temporary 429s", () => {
    const daily = new LLMRequestError({
      status: 429,
      statusText: "Too Many Requests",
      responseBody: '{"code":"free-models-per-day"}',
      rateLimitRemaining: 0,
      rateLimitReset: String(Date.now() + 60_000),
    });
    const temporary = new LLMRequestError({
      status: 429,
      statusText: "Too Many Requests",
      responseBody: "requests per minute exceeded",
    });
    expect(classifyLLMFailure(daily)).toBe("daily_quota_exhausted");
    expect(classifyLLMFailure(temporary)).toBe("temporary_rate_limit");
  });

  it("returns from the primary model without calling a fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("model-a"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
    });
    expect(result.model).toBe("model-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses OpenAI Luna first and GPT-5.4 second without calling OpenRouter", async () => {
    ENV.openaiApiKey = "test-openai-key";
    ENV.openaiModel = "gpt-5.6-luna";
    ENV.openaiModels = ["gpt-5.6-luna", "gpt-5.4"];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("model unavailable", { status: 503 }))
      .mockResolvedValueOnce(success("gpt-5.4"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLMWithFallback({
      provider: "openai",
      messages: [{ role: "user", content: "extract" }],
    });

    expect(result.model).toBe("gpt-5.4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(requestModel(fetchMock.mock.calls[0])).toBe("gpt-5.6-luna");
    expect(requestModel(fetchMock.mock.calls[1])).toBe("gpt-5.4");
    const openAiPayload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(openAiPayload.max_completion_tokens).toBe(32768);
    expect(openAiPayload.max_tokens).toBeUndefined();
    expect(openAiPayload.thinking).toBeUndefined();
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ authorization: "Bearer test-openai-key" })
    );
  });

  it("uses the configured OpenRouter free model when the provider is selected", async () => {
    ENV.openrouterModel = "openrouter/free";
    ENV.openrouterModels = ["openrouter/free"];
    const fetchMock = vi.fn().mockResolvedValue(success("openrouter/free"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLMWithFallback({
      provider: "openrouter",
      messages: [{ role: "user", content: "extract" }],
      maxTokens: 2048,
    });

    expect(result.model).toBe("openrouter/free");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions"
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.model).toBe("openrouter/free");
    expect(payload.max_tokens).toBe(2048);
    expect(payload.max_completion_tokens).toBeUndefined();
    expect(request.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer test-key" })
    );
  });

  it("uses the recommended Nemotron model as the first OpenRouter candidate", async () => {
    ENV.openrouterModel = "nvidia/nemotron-3-super-120b-a12b:free";
    ENV.openrouterModels = [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "fallback-model",
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(success("nvidia/nemotron-3-super-120b-a12b:free"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLMWithFallback({
      provider: "openrouter",
      messages: [{ role: "user", content: "extract" }],
    });

    expect(result.requestedModel).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free"
    );
    expect(requestModel(fetchMock.mock.calls[0])).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends strict JSON schema output requests to OpenRouter", async () => {
    ENV.openrouterModel = "nvidia/nemotron-3-super-120b-a12b:free";
    ENV.openrouterModels = ["nvidia/nemotron-3-super-120b-a12b:free"];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(success("nvidia/nemotron-3-super-120b-a12b:free"));
    vi.stubGlobal("fetch", fetchMock);

    await invokeLLM({
      provider: "openrouter",
      messages: [{ role: "user", content: "extract" }],
      outputSchema: {
        name: "product_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { isMatch: { type: "boolean" } },
          required: ["isMatch"],
        },
      },
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(payload.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "product_extraction",
        strict: true,
        schema: expect.objectContaining({
          additionalProperties: false,
          required: ["isMatch"],
        }),
      },
    });
  });

  it("records the requested model separately from the provider-reported model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("provider-routed-model"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLMWithFallback({
      provider: "openrouter",
      modelOverride: "openrouter/free",
      messages: [{ role: "user", content: "extract" }],
    });

    expect(result.requestedModel).toBe("openrouter/free");
    expect(result.actualModel).toBe("provider-routed-model");
    expect(result.model).toBe("provider-routed-model");
  });

  it("reports missing OpenRouter credentials without making a network request", async () => {
    ENV.openrouterApiKey = "";
    ENV.openrouterModels = ["openrouter/free"];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await invokeLLMWithFallback({
      provider: "openrouter",
      messages: [{ role: "user", content: "extract" }],
    }).catch(error => error as AllLLMModelsFailedError);

    expect(error).toBeInstanceOf(AllLLMModelsFailedError);
    expect(error.message).toContain(
      "AI extraction unavailable: OPENROUTER_API_KEY is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak an API key into aggregate failure diagnostics", async () => {
    ENV.openaiApiKey = "test-openai-key";
    ENV.openaiModels = ["gpt-5.6-luna"];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("authentication failed for sk-secret-value", {
        status: 401,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await invokeLLMWithFallback({
      provider: "openai",
      messages: [{ role: "user", content: "extract" }],
    }).catch(error => error as AllLLMModelsFailedError);

    expect(error).toBeInstanceOf(AllLLMModelsFailedError);
    expect(error.message).not.toContain("test-openai-key");
    expect(error.message).not.toContain("sk-secret-value");
  });

  it("retries a temporary 429 with bounded backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("requests per minute", { status: 429 })
      )
      .mockResolvedValueOnce(success("model-a"));
    vi.stubGlobal("fetch", fetchMock);
    await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestModel(fetchMock.mock.calls[0])).toBe("model-a");
    expect(requestModel(fetchMock.mock.calls[1])).toBe("model-a");
  });

  it("does not retry a daily-exhausted model and immediately uses the fallback", async () => {
    const resetAt = Date.now() + 120_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"free-models-per-day"}', {
          status: 429,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAt),
          },
        })
      )
      .mockResolvedValueOnce(success("model-b"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
    });
    expect(result.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestModel(fetchMock.mock.calls[0])).toBe("model-a");
    expect(requestModel(fetchMock.mock.calls[1])).toBe("model-b");
    expect(getModelState("model-a").unavailableUntil).toBe(resetAt);
  });

  it("skips a quota-exhausted model until reset and makes it eligible afterward", async () => {
    const resetAt = Date.now() + 120_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("openrouter_free_tier_daily", {
          status: 429,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAt),
          },
        })
      )
      .mockResolvedValueOnce(success("model-b"));
    vi.stubGlobal("fetch", fetchMock);
    await invokeLLMWithFallback({
      messages: [{ role: "user", content: "first" }],
    });

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(success("model-b"));
    await invokeLLMWithFallback({
      messages: [{ role: "user", content: "second" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestModel(fetchMock.mock.calls[0])).toBe("model-b");

    expect(
      getModelState("model-a", resetAt + 1).unavailableUntil
    ).toBeUndefined();
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(success("model-a"));
    await invokeLLMWithFallback({
      messages: [{ role: "user", content: "third" }],
    });
    expect(requestModel(fetchMock.mock.calls[0])).toBe("model-a");
  });

  it("returns a sanitized aggregate error after all models fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("model unavailable", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      invokeLLMWithFallback({
        messages: [{ role: "user", content: "extract" }],
      })
    ).rejects.toBeInstanceOf(AllLLMModelsFailedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("moves to Model B when Model A has a provider-specific failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("model unavailable", { status: 404 }))
      .mockResolvedValueOnce(success("model-b"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
    });
    expect(result.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back when a model response fails structured validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(success("model-a"))
      .mockResolvedValueOnce(success("model-b"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
      resultValidator: candidate => {
        if (candidate.model === "model-a") {
          throw new LLMValidationError("invalid product JSON");
        }
      },
    });
    expect(result.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry or switch models for an explicit ambiguous price rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("model-a"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      invokeLLMWithFallback({
        messages: [{ role: "user", content: "extract" }],
        resultValidator: () => {
          throw new LLMValidationError("ambiguous target price", {
            outcome: "AI_PRICE_AMBIGUOUS",
          });
        },
      })
    ).rejects.toBeInstanceOf(AllLLMModelsFailedError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestModel(fetchMock.mock.calls[0])).toBe("model-a");
  });

  it("bounds format retries and then falls back to the next model", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) =>
      success(JSON.parse(String(init.body)).model)
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
      maxRetries: 1,
      resultValidator: candidate => {
        if (candidate.requestedModel === "model-a") {
          throw new LLMValidationError("malformed JSON", {
            retryable: true,
            outcome: "AI_MALFORMED_JSON",
          });
        }
      },
    });
    expect(result.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps routed-model diagnostics when structured validation fails", async () => {
    ENV.llmMaxRetries = 0;
    const fetchMock = vi.fn().mockResolvedValue(success("provider-routed-model"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
      resultValidator: () => {
        throw new LLMValidationError("invalid JSON", {
          outcome: "AI_MALFORMED_JSON",
        });
      },
    }).catch(value => value as AllLLMModelsFailedError);

    expect(error).toBeInstanceOf(AllLLMModelsFailedError);
    expect(error.attempts[0]).toMatchObject({
      requestedModel: "model-a",
      actualModel: "provider-routed-model",
      outcome: "AI_MALFORMED_JSON",
      attempt: 1,
    });
  });

  it("does not retry or switch models after a deterministic safety rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success("model-a"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await invokeLLMWithFallback({
      messages: [{ role: "user", content: "extract" }],
      resultValidator: () => {
        throw new LLMValidationError("identity conflict", {
          outcome: "AI_PRODUCT_FOUND_VALIDATION_REJECTED",
        });
      },
    }).catch(value => value as AllLLMModelsFailedError);

    expect(error).toBeInstanceOf(AllLLMModelsFailedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.attempts[0].outcome).toBe(
      "AI_PRODUCT_FOUND_VALIDATION_REJECTED"
    );
  });

  it("never exceeds the configured global LLM concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url, init: RequestInit) => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active--;
        return success(JSON.parse(String(init.body)).model);
      });
    vi.stubGlobal("fetch", fetchMock);
    const count = ENV.llmMaxConcurrency + 3;
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        invokeLLM({
          messages: [{ role: "user", content: `extract-${index}` }],
          modelOverride: "model-a",
        })
      )
    );
    expect(maximum).toBeLessThanOrEqual(ENV.llmMaxConcurrency);
  });
});
