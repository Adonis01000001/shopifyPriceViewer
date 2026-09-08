import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACTOR_VERSION } from "./product-content-extraction";

const mocks = vi.hoisted(() => ({
  invokeLLMWithFallback: vi.fn(),
  requireDb: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("../_core/db-assert", () => ({ requireDb: mocks.requireDb }));
vi.mock("../_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/llm")>();
  return { ...actual, invokeLLMWithFallback: mocks.invokeLLMWithFallback };
});
vi.mock("./extraction-failure-intelligence.service", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("./extraction-failure-intelligence.service")
    >();
  return {
    ...actual,
    extractionFailureIntelligenceService: {
      ...actual.extractionFailureIntelligenceService,
      recordFailure: mocks.recordFailure,
    },
  };
});

import { aiExtractionService } from "./ai-extraction.service";
import { contentHash } from "./product-content-extraction";
import { AllLLMModelsFailedError } from "../_core/llm";

function fakeDatabase(rows: Record<string, unknown>[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const selectChain: Record<string, any> = {};
  selectChain.from = vi.fn(() => selectChain);
  selectChain.where = vi.fn(() => selectChain);
  selectChain.orderBy = vi.fn(() => selectChain);
  selectChain.limit = vi.fn(async () => rows);
  return {
    inserted,
    database: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            returning: vi.fn(async () => [
              { id: `extraction-${inserted.length}` },
            ]),
          };
        }),
      })),
    },
  };
}

function input(content: string, suffix = "one") {
  return {
    merchantProduct: {
      id: `11111111-1111-4111-8111-1111111111${suffix === "one" ? "11" : "22"}`,
      title: "Philips Hue White and Color Ambiance Starter Kit",
      sku: "HUE-STARTER-01",
      vendor: "Philips Hue",
      price: "159.99",
    },
    competitorPageContent: content,
    competitorUrl: `https://competitor.example/${suffix}`,
    competitorDomain: "competitor.example",
    competitorId: `22222222-2222-4222-8222-2222222222${suffix === "one" ? "11" : "22"}`,
  };
}

function llmResult() {
  return {
    id: "llm-result",
    created: 1,
    model: "model-a",
    requestedModel: "nvidia/nemotron-3-super-120b-a12b:free",
    actualModel: "model-a",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content: JSON.stringify({
            isMatch: true,
            targetProductFound: true,
            confidence: 0.95,
            matchConfidence: 0.96,
            skuMatchConfidence: 0,
            titleSimilarity: 0.96,
            variantSimilarity: 1,
            price: 149.99,
            currency: "USD",
            salePrice: null,
            originalPrice: null,
            title: "Philips Hue White and Color Ambiance Starter Kit",
            description: "Smart lighting kit",
            features: ["Color lighting"],
            reasoning: "Exact title and variant match",
            brand: "Philips Hue",
            model: "White and Color Ambiance Starter Kit",
            generation: null,
            capacity: null,
            variant: "Starter Kit",
            priceAssociation: "exact",
            products: [
              {
                title: "Philips Hue White and Color Ambiance Starter Kit",
                brand: "Philips Hue",
                model: "White and Color Ambiance Starter Kit",
                variant: "Starter Kit",
                prices: [
                  { amount: 149.99, currency: "USD", association: "exact" },
                ],
              },
            ],
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

describe("AI extraction pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fake = fakeDatabase();
    mocks.requireDb.mockResolvedValue(fake.database);
    mocks.recordFailure.mockResolvedValue({ id: "failure-1" });
  });

  it("persists complete JSON-LD extraction without an LLM request", async () => {
    const content = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Philips Hue White and Color Ambiance Starter Kit",
      sku: "HUE-STARTER-01",
      brand: { "@type": "Brand", name: "Philips Hue" },
      offers: { "@type": "Offer", price: "149.99", priceCurrency: "USD" },
    })}</script>`;
    const result = await aiExtractionService.extractAndValidate(input(content));
    expect(result.extraction.price).toBe(149.99);
    expect(result.passedThreshold).toBe(true);
    expect(mocks.invokeLLMWithFallback).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    const database = await mocks.requireDb.mock.results[0].value;
    expect(database.insert).toHaveBeenCalledTimes(1);
  });

  it("uses the LLM when deterministic extraction is incomplete", async () => {
    const fake = fakeDatabase();
    mocks.requireDb.mockResolvedValue(fake.database);
    mocks.invokeLLMWithFallback.mockImplementation(async params => {
      const result = llmResult();
      params.resultValidator?.(result);
      return result;
    });
    const result = await aiExtractionService.extractAndValidate(
      {
        ...input(
          "# Similar product\nPrice: $149.99\nNo structured product metadata",
          "two"
        ),
        candidateTitle: "Philips Hue White and Color Ambiance Starter Kit",
        pageClassification: "probable_product",
      }
    );
    expect(result.extraction.price).toBe(149.99);
    expect(mocks.invokeLLMWithFallback).toHaveBeenCalledTimes(1);
    const llmParams = mocks.invokeLLMWithFallback.mock.calls[0][0];
    expect(llmParams.provider).toBe("openrouter");
    expect(llmParams.messages[0].content).toContain(
      "Related products, recommendations, accessories"
    );
    expect(llmParams.messages[0].content).toContain(
      "set targetProductFound/isMatch appropriately"
    );
    expect(llmParams.messages[0].content).toContain(
      "JBL Flip 5 is not JBL Flip 6"
    );
    expect(llmParams.messages[1].content).toContain("GTIN/barcode");
    expect(llmParams.maxRetries).toBe(1);
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1);
    expect(fake.inserted[0].rawResponse).toMatchObject({
      provider: "openrouter",
      aiStatus: "success",
      aiModel: "model-a",
      requestedModel: "nvidia/nemotron-3-super-120b-a12b:free",
      actualModel: "model-a",
      status: "AI_SUCCESS",
      candidateUrl: "https://competitor.example/two",
      productId: "11111111-1111-4111-8111-111111111122",
      candidateTitle: "Philips Hue White and Color Ambiance Starter Kit",
      pageClassification: "probable_product",
      structuredOutputValid: true,
      outcome: "FINAL_MATCH",
      priceAssociation: "exact",
      targetProductFound: true,
      brand: "Philips Hue",
      model: "White and Color Ambiance Starter Kit",
    });
  });

  it("classifies a provider response without choices as an empty AI response", async () => {
    const fake = fakeDatabase();
    mocks.requireDb.mockResolvedValue(fake.database);
    mocks.invokeLLMWithFallback.mockResolvedValue({
      id: "llm-result",
      created: 1,
      model: "provider-routed-model",
      requestedModel: "openrouter/free",
      actualModel: "provider-routed-model",
      choices: undefined,
    });

    await aiExtractionService.extractAndValidate(
      input("Unrelated page text\nPrice: $149.99", "two")
    );

    expect(fake.inserted[0].rawResponse).toMatchObject({
      status: "AI_EMPTY_RESPONSE",
      outcome: "AI_EMPTY_RESPONSE",
      requestedModel: "openrouter/free",
      actualModel: "provider-routed-model",
      structuredOutputValid: false,
    });
  });

  it("rejects an AI match that conflicts with deterministic identity evidence", async () => {
    const fake = fakeDatabase();
    mocks.requireDb.mockResolvedValue(fake.database);
    mocks.invokeLLMWithFallback.mockImplementation(async params => {
      const result = llmResult();
      params.resultValidator?.(result);
      return result;
    });
    const content = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Ring Video Doorbell",
      brand: { name: "Ring" },
      offers: { price: "149.99", priceCurrency: "USD" },
    })}</script>`;

    const result = await aiExtractionService.extractAndValidate(
      input(content, "two")
    );

    expect(result.passedThreshold).toBe(false);
    expect(result.modelUsed).toBe("deterministic:pending-ai");
    expect(fake.inserted[0]).toMatchObject({
      modelUsed: "deterministic:pending-ai",
    });
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).aiStatus
    ).toBe("error");
  });

  it("shares one LLM request between duplicate in-flight jobs", async () => {
    mocks.invokeLLMWithFallback.mockImplementation(async params => {
      await new Promise(resolve => setTimeout(resolve, 15));
      const result = llmResult();
      params.resultValidator?.(result);
      return result;
    });
    const extractionInput = input(
      "# Similar product\nPrice: $149.99\nNo structured product metadata",
      "two"
    );
    const [first, second] = await Promise.all([
      aiExtractionService.extractAndValidate(extractionInput),
      aiExtractionService.extractAndValidate(extractionInput),
    ]);
    expect(first.dbId).toBe(second.dbId);
    expect(mocks.invokeLLMWithFallback).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1);
  });

  it("reuses the persisted extraction when URL content has not changed", async () => {
    const content = "# Similar product\nPrice: $149.99\nStable product page";
    const cachedRecord = {
      id: "cached-extraction",
      isMatch: true,
      confidence: 0.95,
      matchConfidence: 0.96,
      skuMatchConfidence: 0,
      titleSimilarity: 0.96,
      variantSimilarity: 1,
      extractedPrice: "149.99",
      extractedCurrency: "USD",
      extractedSalePrice: null,
      extractedOriginalPrice: null,
      extractedTitle: "Philips Hue White and Color Ambiance Starter Kit",
      extractedDescription: "Smart lighting kit",
      extractedFeatures: ["Color lighting"],
      reasoning: "Cached validated extraction",
      rawResponse: {
        contentHash: contentHash(content),
        extractorVersion: EXTRACTOR_VERSION,
      },
    };
    const fake = fakeDatabase([cachedRecord]);
    mocks.requireDb.mockResolvedValue(fake.database);
    const result = await aiExtractionService.extractAndValidate(
      input(content, "two")
    );
    expect(result.dbId).toBe("cached-extraction");
    expect(result.extraction.price).toBe(149.99);
    expect(mocks.invokeLLMWithFallback).not.toHaveBeenCalled();
    expect(fake.database.insert).not.toHaveBeenCalled();
  });

  it("preserves deterministic evidence when every AI model is unavailable", async () => {
    const fake = fakeDatabase();
    mocks.requireDb.mockResolvedValue(fake.database);
    mocks.invokeLLMWithFallback.mockRejectedValue(
      new AllLLMModelsFailedError([
        {
          model: "model-a",
          requestedModel: "openrouter/free",
          actualModel: "provider-routed-model",
          outcome: "AI_RATE_LIMIT",
          attempt: 1,
          category: "daily_quota_exhausted",
          message: "quota",
        },
      ])
    );
    const content = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Some Product",
      offers: { price: "149.99", priceCurrency: "USD" },
    })}</script>`;
    const result = await aiExtractionService.extractAndValidate(
      input(content, "two")
    );
    expect(result.passedThreshold).toBe(false);
    expect(result.extraction.price).toBe(149.99);
    expect(fake.inserted[0]).toMatchObject({
      modelUsed: "deterministic:pending-ai",
    });
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).needsAi
    ).toBe(true);
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).aiErrorCategory
    ).toBe("daily_quota_exhausted");
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).outcome
    ).toBe("AI_RATE_LIMIT");
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).status
    ).toBe("AI_RATE_LIMIT");
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).actualModel
    ).toBe("provider-routed-model");
    expect(
      (fake.inserted[0].rawResponse as Record<string, unknown>).candidateUrl
    ).toBe("https://competitor.example/two");
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1);
  });
});
