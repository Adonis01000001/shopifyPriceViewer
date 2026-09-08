import { eq, and, desc } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  aiExtractions,
  products,
  type AiExtraction,
} from "../../drizzle/schema";
import {
  AllLLMModelsFailedError,
  invokeLLMWithFallback,
  LLMValidationError,
  type InvokeResult,
} from "../_core/llm";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";
import {
  assessProductMatch,
  contentHash,
  deduplicateExtraction,
  EXTRACTOR_VERSION,
  extractDeterministicProduct,
  reduceProductContent,
  type DeterministicProductData,
  type ProductMatchAssessment,
} from "./product-content-extraction";
import {
  extractionFailureIntelligenceService,
  fingerprintStorefront,
  normalizeFailureDomain,
} from "./extraction-failure-intelligence.service";
import { jobQueueService } from "./job-queue.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractionInput {
  merchantProduct: {
    id: string;
    title: string;
    description?: string | null;
    sku?: string | null;
    barcode?: string | null;
    vendor?: string | null;
    category?: string | null;
    price?: string | null;
    gtin?: string | null;
    mpn?: string | null;
    modelNumber?: string | null;
    productType?: string | null;
    tags?: string | null;
  };
  competitorPageContent: string;
  competitorUrl: string;
  competitorDomain: string;
  competitorId?: string;
  candidateTitle?: string | null;
  pageClassification?: string | null;
}

export type PriceAssociation = "exact" | "strong" | "ambiguous" | "unknown";

export interface ExtractedPriceEvidence {
  amount: number;
  currency: string;
  association: PriceAssociation;
}

export interface ExtractedProductCandidate {
  title: string | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  prices: ExtractedPriceEvidence[];
}

export interface ExtractionResult {
  isMatch: boolean;
  confidence: number;
  matchConfidence: number;
  skuMatchConfidence: number;
  titleSimilarity: number;
  variantSimilarity: number;
  price: number | null;
  currency: string;
  salePrice: number | null;
  originalPrice: number | null;
  title: string | null;
  description: string | null;
  features: string[];
  reasoning: string;
  targetProductFound: boolean;
  brand: string | null;
  model: string | null;
  generation: string | null;
  capacity: string | null;
  variant: string | null;
  priceAssociation: PriceAssociation;
  productCandidates: ExtractedProductCandidate[];
  /** A conservative, non-LLM identity confirmation from structured evidence. */
  deterministicMatch?: boolean;
}

export interface ValidatedExtraction {
  extraction: ExtractionResult;
  dbId: string;
  passedThreshold: boolean;
  modelUsed: string | null;
}

export type ExtractionFailureCode =
  | "DETERMINISTIC_EXTRACTION_FAILED"
  | "LLM_VALIDATION_FAILED"
  | "ALL_LLM_MODELS_FAILED";

export type AIExtractionOutcome =
  | "AI_SUCCESS"
  | "AI_API_ERROR"
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "AI_EMPTY_RESPONSE"
  | "AI_MALFORMED_JSON"
  | "AI_SCHEMA_VALIDATION_ERROR"
  | "AI_PRODUCT_NOT_FOUND"
  | "AI_PRODUCT_FOUND_VALIDATION_REJECTED"
  | "AI_PRICE_AMBIGUOUS"
  | "AI_PRICE_MISSING"
  | "FINAL_MATCH";

export class ExtractionPipelineError extends Error {
  constructor(
    readonly code: ExtractionFailureCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ExtractionPipelineError";
  }
}

const extractionMetrics = {
  deterministicAttempts: 0,
  deterministicSuccesses: 0,
  highConfidenceSaves: 0,
  ambiguousExtractions: 0,
  unresolvedExtractions: 0,
  priceConflicts: 0,
  variantAmbiguities: 0,
  resolutionStates: {} as Record<string, number>,
  failureReasons: {} as Record<string, number>,
  deterministicSources: {} as Record<string, number>,
  llmRequests: 0,
  llmSuccesses: 0,
  llmFailures: 0,
  cacheHits: 0,
  contentCharsBefore: 0,
  contentCharsAfter: 0,
  outcomes: {} as Record<AIExtractionOutcome, number>,
};

export function getExtractionMetrics() {
  const reductions = extractionMetrics.llmRequests || 1;
  return {
    ...extractionMetrics,
    deterministicSources: { ...extractionMetrics.deterministicSources },
    resolutionStates: { ...extractionMetrics.resolutionStates },
    failureReasons: { ...extractionMetrics.failureReasons },
    outcomes: { ...extractionMetrics.outcomes },
    llmExtractionPercentage:
      extractionMetrics.llmRequests /
      Math.max(1, extractionMetrics.deterministicAttempts),
    averageContentCharsBefore:
      extractionMetrics.contentCharsBefore / reductions,
    averageContentCharsAfter: extractionMetrics.contentCharsAfter / reductions,
  };
}

function aiFailureCategory(error: unknown): string {
  if (error instanceof LLMValidationError) return "validation_failed";
  if (error instanceof AllLLMModelsFailedError) {
    const categories = error.attempts.map(attempt => attempt.category);
    return (
      categories.find(category => category === "configuration_error") ??
      categories.find(category => category === "daily_quota_exhausted") ??
      categories.find(category => category === "temporary_rate_limit") ??
      categories[0] ??
      "all_models_failed"
    );
  }
  return "all_models_failed";
}

function aiOutcomeForValidation(error: unknown): AIExtractionOutcome {
  if (error instanceof LLMValidationError) {
    if (error.outcome === "AI_EMPTY_RESPONSE") return "AI_EMPTY_RESPONSE";
    if (error.outcome === "AI_MALFORMED_JSON") return "AI_MALFORMED_JSON";
    if (error.outcome === "AI_SCHEMA_VALIDATION_ERROR") {
      return "AI_SCHEMA_VALIDATION_ERROR";
    }
    if (error.outcome === "AI_PRODUCT_FOUND_VALIDATION_REJECTED") {
      return "AI_PRODUCT_FOUND_VALIDATION_REJECTED";
    }
    if (error.outcome === "AI_PRICE_AMBIGUOUS") {
      return "AI_PRICE_AMBIGUOUS";
    }
    if (/no JSON object/i.test(error.message)) return "AI_EMPTY_RESPONSE";
    if (/not valid JSON|JSON object|parse/i.test(error.message)) {
      return "AI_MALFORMED_JSON";
    }
    if (/identity|variant|conflict|threshold/i.test(error.message)) {
      return "AI_PRODUCT_FOUND_VALIDATION_REJECTED";
    }
    return "AI_SCHEMA_VALIDATION_ERROR";
  }

  if (error instanceof AllLLMModelsFailedError) {
    const validation = error.attempts.find(
      attempt => attempt.category === "validation_failed"
    );
    if (validation?.outcome) {
      return validation.outcome as AIExtractionOutcome;
    }
    if (validation) {
      return aiOutcomeForValidation(new LLMValidationError(validation.message));
    }
    if (error.attempts.some(attempt => attempt.category === "timeout")) {
      return "AI_TIMEOUT";
    }
    if (
      error.attempts.some(attempt =>
        ["temporary_rate_limit", "daily_quota_exhausted"].includes(
          attempt.category
        )
      )
    ) {
      return "AI_RATE_LIMIT";
    }
  }

  return "AI_API_ERROR";
}

function aiFailureOutcome(error: unknown): AIExtractionOutcome {
  if (error instanceof LLMValidationError) {
    return aiOutcomeForValidation(error);
  }
  if (error instanceof AllLLMModelsFailedError) {
    return aiOutcomeForValidation(error);
  }
  if (error instanceof Error && /JSON|schema|extraction value/i.test(error.message)) {
    return aiOutcomeForValidation(
      new LLMValidationError(error.message, {
        retryable: true,
        outcome: /no JSON object|not valid JSON/i.test(error.message)
          ? "AI_MALFORMED_JSON"
          : "AI_SCHEMA_VALIDATION_ERROR",
      })
    );
  }
  return "AI_API_ERROR";
}

function persistedOutcome(extraction: ExtractionResult): AIExtractionOutcome {
  if (!extraction.isMatch) return "AI_PRODUCT_NOT_FOUND";
  if (extraction.price == null) return "AI_PRICE_MISSING";
  return extraction.confidence >= ENV.matchConfidenceThreshold
    ? "FINAL_MATCH"
    : "AI_PRODUCT_FOUND_VALIDATION_REJECTED";
}

function safeModelContent(content: string): string {
  return content
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 32_000);
}

function llmAttemptDiagnostics(error: unknown): Array<Record<string, unknown>> {
  if (!(error instanceof AllLLMModelsFailedError)) return [];
  return error.attempts.map(attempt => ({
    model: attempt.model,
    requestedModel: attempt.requestedModel ?? attempt.model,
    actualModel: attempt.actualModel ?? null,
    attempt: attempt.attempt ?? null,
    outcome: attempt.outcome ?? null,
    category: attempt.category,
    status: attempt.status ?? null,
    message: attempt.message,
  }));
}

function recordOutcome(outcome: AIExtractionOutcome): void {
  extractionMetrics.outcomes[outcome] =
    (extractionMetrics.outcomes[outcome] ?? 0) + 1;
}

// ─── JSON Schema for Structured Output ───────────────────────────────────────

const EXTRACTION_SCHEMA = {
  name: "product_extraction",
  schema: {
    type: "object",
    properties: {
      targetProductFound: {
        type: "boolean",
        description:
          "Whether the exact requested product identity is represented on the candidate page",
      },
      isMatch: {
        type: "boolean",
        description:
          "Whether the competitor product is an exact match for the merchant product",
      },
      confidence: {
        type: "number",
        description: "Overall confidence score from 0.0 to 1.0",
      },
      matchConfidence: {
        type: "number",
        description:
          "Confidence that this is the same product (brand + model match)",
      },
      skuMatchConfidence: {
        type: "number",
        description: "Confidence based on SKU/barcode matching",
      },
      titleSimilarity: {
        type: "number",
        description: "How similar the titles are (0.0 to 1.0)",
      },
      variantSimilarity: {
        type: "number",
        description: "How similar the variants are (color, size, storage)",
      },
      price: {
        type: ["number", "null"],
        description: "Current selling price for the target product only",
      },
      currency: {
        type: "string",
        description: "Currency code (USD, EUR, GBP)",
      },
      salePrice: {
        type: ["number", "null"],
        description: "Sale price if on sale, null if not",
      },
      originalPrice: {
        type: ["number", "null"],
        description: "Original price before discount, null if not on sale",
      },
      title: {
        type: ["string", "null"],
        description: "Product title from competitor page",
      },
      description: {
        type: ["string", "null"],
        description: "Product description from competitor page",
      },
      features: {
        type: "array",
        items: { type: "string" },
        description: "Key product features",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of match decision",
      },
      brand: {
        type: ["string", "null"],
        description: "Brand of the target product represented on the page",
      },
      model: {
        type: ["string", "null"],
        description: "Model name or model number of the target product",
      },
      generation: {
        type: ["string", "null"],
        description: "Generation or revision, when explicitly present",
      },
      capacity: {
        type: ["string", "null"],
        description: "Capacity/storage/size attribute, when explicitly present",
      },
      variant: {
        type: ["string", "null"],
        description: "Requested product variant and important options",
      },
      priceAssociation: {
        type: "string",
        enum: ["exact", "strong", "ambiguous", "unknown"],
        description:
          "How confidently the selected price is tied to the target product",
      },
      products: {
        type: "array",
        description:
          "Every relevant product candidate found on the page and the prices attached to each candidate",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: ["string", "null"] },
            brand: { type: ["string", "null"] },
            model: { type: ["string", "null"] },
            variant: { type: ["string", "null"] },
            prices: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  amount: { type: "number" },
                  currency: { type: "string" },
                  association: {
                    type: "string",
                    enum: ["exact", "strong", "ambiguous", "unknown"],
                  },
                },
                required: ["amount", "currency", "association"],
              },
            },
          },
          required: ["title", "brand", "model", "variant", "prices"],
        },
      },
    },
    required: [
      "targetProductFound",
      "isMatch",
      "confidence",
      "matchConfidence",
      "skuMatchConfidence",
      "titleSimilarity",
      "variantSimilarity",
      "price",
      "currency",
      "salePrice",
      "originalPrice",
      "title",
      "description",
      "features",
      "reasoning",
      "brand",
      "model",
      "generation",
      "capacity",
      "variant",
      "priceAssociation",
      "products",
    ],
    additionalProperties: false,
  },
  strict: true,
} as const;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildExtractionPrompt(input: ExtractionInput): {
  system: string;
  user: string;
} {
  const { merchantProduct, competitorPageContent, competitorUrl } = input;

  const system = `Return ONLY a single JSON object with EXACTLY the schema keys and no others. The response must include:
targetProductFound, isMatch, confidence, matchConfidence, skuMatchConfidence, titleSimilarity, variantSimilarity, price, currency, salePrice, originalPrice, title, description, features, reasoning, brand, model, generation, capacity, variant, priceAssociation, and products.
Do not nest these under any other key. Do not wrap them in objects such as "match" or "competitor". Do not add commentary before or after the JSON.
"price" MUST be a number you literally read on the competitor page. If the page shows no price, set price to null. Never copy the merchant's own price.

You are a product matching and price extraction AI. Analyze a competitor's product page and determine if it matches the merchant's product, then extract structured data.

Rules:
- The merchant product identity above is authoritative. Determine whether this exact target product is represented on the page; do not find a vaguely related product.
- Prioritize evidence in this order: exact model number, exact product identifier, brand + model, brand + model + generation, brand + model + capacity/variant, near-exact title, structured Product data, then other supporting evidence.
- Extract brand, model, generation, capacity/storage, and variant separately. Important differentiators include generation, capacity, storage, screen size, color, quantity, bundle contents, included accessories, wired/battery, regional version, and model number.
- A title alone is not enough. JBL Flip 5 is not JBL Flip 6; Kindle Paperwhite 8GB is not Kindle Paperwhite 16GB; Ring Wired Doorbell 2nd Gen is not automatically Ring Video Doorbell.
- The targetProductFound field means identity evidence exists. isMatch must be false when price, variant, identity, or evidence is insufficient.
- iPhone 14 Blue 128GB MATCHES iPhone 14 Blue 128GB.
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Black 128GB (different color).
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Blue 256GB (different storage).
- iPhone 14 DOES NOT MATCH iPhone 15 (different model).
- Related products, recommendations, accessories, bundles, and navigation prices are not the target product.
- Subscription, member, recurring, installment, shipping, and per-unit prices are not the target price unless the requested product itself is that subscription or unit-based product.
- Extract the price for the requested product/variant only. Do not use the first price on the page.
- Prefer a clearly identified sale price as the current price; keep compare-at/original price separate and never substitute it for the current price.
- List every relevant product candidate in products and attach each observed price to the candidate it belongs to. Set priceAssociation to exact only when the selected price is explicitly associated with the target product. Use ambiguous or unknown when association cannot be proven; an ambiguous price must not be used for a match.
- JSON-LD/schema.org Product fields (name, brand, model, sku, gtin, offers, price, priceCurrency, availability) are strong evidence, but still must agree with the target identity and deterministic validation.
- Do not infer or calculate a price that is not explicitly supported by the supplied page content.
- If exact identity, variant, currency, or current price cannot be established with sufficient confidence, set targetProductFound/isMatch appropriately, use priceAssociation ambiguous or unknown, and set price to null rather than guessing.
- Extract current price, sale price (if on sale), and original price.
- Return ONLY valid JSON matching the schema. No markdown.`;

  const user = `## TARGET PRODUCT
Title: ${merchantProduct.title}
Brand: ${merchantProduct.vendor ?? "Unknown"}
Model number: ${merchantProduct.modelNumber ?? "N/A"}
MPN: ${merchantProduct.mpn ?? "N/A"}
GTIN/barcode: ${merchantProduct.gtin ?? merchantProduct.barcode ?? "N/A"}
SKU: ${merchantProduct.sku ?? "N/A"}
Barcode: ${merchantProduct.barcode ?? "N/A"}
Category: ${merchantProduct.category ?? "N/A"}
Product type: ${merchantProduct.productType ?? "N/A"}
Tags/variant hints: ${merchantProduct.tags ?? "N/A"}
Current Price: ${merchantProduct.price ?? "N/A"}
Description: ${(merchantProduct.description ?? "").slice(0, 500)}

## CANDIDATE PAGE
URL:
${competitorUrl}
Page classification: ${input.pageClassification ?? "unknown"}

Relevant page content, structured data, headings, metadata, variants, availability, and price blocks:
${competitorPageContent}

## Task
1. Decide whether the exact target product and requested variant are present.
2. Extract identity attributes separately and enumerate relevant product candidates.
3. Associate prices with the product candidate they belong to; never select the first, cheapest, or nearest price.
4. Extract current, sale, original/compare-at price and currency only when supported by evidence.
5. Return structured JSON only.`;

  return { system, user };
}

// ─── Response Parser ─────────────────────────────────────────────────────────

/**
 * Pull the first balanced JSON object out of a model response.
 * Not every provider honours response_format: json_schema. Reasoning models in
 * particular return prose and then the object, so locating the object is more
 * reliable than trusting the whole body to be JSON.
 */
function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const haystack = fenced ? fenced[1] : text;
  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

function parseExtractionResponse(raw: string): ExtractionResult {
  const jsonStr = extractJsonObject(raw);
  if (jsonStr === null) {
    throw new Error(
      `LLM returned no JSON object. First 200 chars: ${raw.trim().slice(0, 200)}`
    );
  }

  const parsed = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM response does not match the extraction schema");
  }
  const required = [
    "targetProductFound",
    "isMatch",
    "confidence",
    "matchConfidence",
    "skuMatchConfidence",
    "titleSimilarity",
    "variantSimilarity",
    "price",
    "currency",
    "salePrice",
    "originalPrice",
    "title",
    "description",
    "features",
    "reasoning",
    "brand",
    "model",
    "generation",
    "capacity",
    "variant",
    "priceAssociation",
    "products",
  ];
  const nullableStrings = [
    parsed.brand,
    parsed.model,
    parsed.generation,
    parsed.capacity,
    parsed.variant,
    parsed.title,
    parsed.description,
  ];
  const priceAssociations = ["exact", "strong", "ambiguous", "unknown"];
  if (
    required.some(key => !Object.prototype.hasOwnProperty.call(parsed, key)) ||
    typeof parsed.targetProductFound !== "boolean" ||
    typeof parsed.isMatch !== "boolean" ||
    typeof parsed.currency !== "string" ||
    typeof parsed.reasoning !== "string" ||
    typeof parsed.priceAssociation !== "string" ||
    !priceAssociations.includes(parsed.priceAssociation) ||
    !Array.isArray(parsed.features) ||
    parsed.features.some((feature: unknown) => typeof feature !== "string") ||
    !Array.isArray(parsed.products) ||
    nullableStrings.some(
      value => value !== null && typeof value !== "string"
    ) ||
    parsed.products.some(
      (candidate: unknown) =>
        !candidate ||
        typeof candidate !== "object" ||
        !["title", "brand", "model", "variant", "prices"].every(key =>
          Object.prototype.hasOwnProperty.call(candidate, key)
        ) ||
        [
          (candidate as Record<string, unknown>).title,
          (candidate as Record<string, unknown>).brand,
          (candidate as Record<string, unknown>).model,
          (candidate as Record<string, unknown>).variant,
        ].some(value => value !== null && typeof value !== "string") ||
        !Array.isArray((candidate as Record<string, unknown>).prices) ||
        ((candidate as Record<string, unknown>).prices as unknown[]).some(
          (price: unknown) => {
            if (!price || typeof price !== "object") return true;
            const item = price as Record<string, unknown>;
            return (
              typeof item.amount !== "number" ||
              !Number.isFinite(item.amount) ||
              typeof item.currency !== "string" ||
              typeof item.association !== "string" ||
              !priceAssociations.includes(item.association)
            );
          }
        )
    )
  ) {
    throw new Error("LLM response does not match the extraction schema");
  }
  const rawScores = [
    parsed.confidence,
    parsed.matchConfidence,
    parsed.skuMatchConfidence,
    parsed.titleSimilarity,
    parsed.variantSimilarity,
  ];
  const rawPrices = [parsed.price, parsed.salePrice, parsed.originalPrice];
  if (
    rawScores.some(
      value => typeof value !== "number" || !Number.isFinite(value)
    ) ||
    rawPrices.some(
      value =>
        value !== null && (typeof value !== "number" || !Number.isFinite(value))
    ) ||
    ![parsed.title, parsed.description].every(
      value => value === null || typeof value === "string"
    )
  ) {
    throw new Error("LLM response contains invalid extraction value types");
  }

  return {
    isMatch: Boolean(parsed.isMatch),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
    matchConfidence: Math.min(
      1,
      Math.max(0, Number(parsed.matchConfidence) || 0)
    ),
    skuMatchConfidence: Math.min(
      1,
      Math.max(0, Number(parsed.skuMatchConfidence) || 0)
    ),
    titleSimilarity: Math.min(
      1,
      Math.max(0, Number(parsed.titleSimilarity) || 0)
    ),
    variantSimilarity: Math.min(
      1,
      Math.max(0, Number(parsed.variantSimilarity) || 0)
    ),
    price: parsed.price != null ? Number(parsed.price) : null,
    currency: parsed.currency.toUpperCase(),
    salePrice: parsed.salePrice != null ? Number(parsed.salePrice) : null,
    originalPrice:
      parsed.originalPrice != null ? Number(parsed.originalPrice) : null,
    title: parsed.title ? String(parsed.title) : null,
    description: parsed.description ? String(parsed.description) : null,
    features: Array.isArray(parsed.features) ? parsed.features.map(String) : [],
    reasoning: String(parsed.reasoning || ""),
    targetProductFound: Boolean(parsed.targetProductFound),
    brand: parsed.brand == null ? null : String(parsed.brand),
    model: parsed.model == null ? null : String(parsed.model),
    generation: parsed.generation == null ? null : String(parsed.generation),
    capacity: parsed.capacity == null ? null : String(parsed.capacity),
    variant: parsed.variant == null ? null : String(parsed.variant),
    priceAssociation: parsed.priceAssociation as PriceAssociation,
    productCandidates: parsed.products.map(
      (candidate: Record<string, unknown>) => ({
        title: candidate.title == null ? null : String(candidate.title),
        brand: candidate.brand == null ? null : String(candidate.brand),
        model: candidate.model == null ? null : String(candidate.model),
        variant: candidate.variant == null ? null : String(candidate.variant),
        prices: (candidate.prices as Array<Record<string, unknown>>).map(
          price => ({
            amount: Number(price.amount),
            currency: String(price.currency).toUpperCase(),
            association: price.association as PriceAssociation,
          })
        ),
      })
    ),
    deterministicMatch: false,
  };
}

function contentFromResult(result: InvokeResult): string {
  const content = Array.isArray(result?.choices)
    ? result.choices[0]?.message?.content
    : undefined;
  if (content == null) return "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

function assertValidExtraction(extraction: ExtractionResult): void {
  const scores = [
    extraction.confidence,
    extraction.matchConfidence,
    extraction.skuMatchConfidence,
    extraction.titleSimilarity,
    extraction.variantSimilarity,
  ];
  if (scores.some(score => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new LLMValidationError(
      "Extraction contains invalid confidence scores",
      { retryable: true, outcome: "AI_SCHEMA_VALIDATION_ERROR" }
    );
  }
  for (const price of [
    extraction.price,
    extraction.salePrice,
    extraction.originalPrice,
  ]) {
    if (price != null && (!Number.isFinite(price) || price <= 0)) {
      throw new LLMValidationError("Extraction contains an invalid price", {
        retryable: true,
        outcome: "AI_SCHEMA_VALIDATION_ERROR",
      });
    }
  }
  if (!/^[A-Z]{3}$/.test(extraction.currency)) {
    throw new LLMValidationError(
      "Extraction contains an invalid currency code",
      { retryable: true, outcome: "AI_SCHEMA_VALIDATION_ERROR" }
    );
  }
  if (extraction.price != null && !extraction.title) {
    throw new LLMValidationError(
      "Extraction with a price must include a product title",
      { retryable: true, outcome: "AI_SCHEMA_VALIDATION_ERROR" }
    );
  }
}

/**
 * AI can resolve incomplete page evidence, but it cannot override a
 * deterministic identity/variant conflict. The numeric title and variant
 * guards mirror the conservative thresholds used by the deterministic
 * matcher; the overall match-confidence threshold is still applied when the
 * extraction is persisted and consumed by the pipeline.
 */
function assertAiIdentityConsistency(
  extraction: ExtractionResult,
  deterministicAssessment: ProductMatchAssessment | null
): void {
  if (!extraction.isMatch) return;

  if (!extraction.targetProductFound) {
    throw new LLMValidationError(
      "AI marked a match without confirming that the target product is present",
      { outcome: "AI_PRODUCT_FOUND_VALIDATION_REJECTED" }
    );
  }
  if (extraction.priceAssociation !== "exact") {
    throw new LLMValidationError(
      "AI price is not explicitly associated with the target product",
      { outcome: "AI_PRICE_AMBIGUOUS" }
    );
  }
  if (extraction.price != null) {
    const hasSupportingPriceEvidence = extraction.productCandidates.some(
      candidate =>
        candidate.prices.some(
          price =>
            price.association === "exact" &&
            price.currency === extraction.currency &&
            Math.abs(price.amount - extraction.price!) < 0.005
        )
    );
    if (!hasSupportingPriceEvidence) {
      throw new LLMValidationError(
        "AI selected a price without matching candidate-level evidence",
        { outcome: "AI_PRICE_AMBIGUOUS" }
      );
    }
  }

  if (extraction.titleSimilarity < 0.82) {
    throw new LLMValidationError(
      "AI match does not meet the deterministic title similarity threshold",
      { outcome: "AI_PRODUCT_FOUND_VALIDATION_REJECTED" }
    );
  }
  if (extraction.variantSimilarity !== 1) {
    throw new LLMValidationError(
      "AI match has an unresolved variant mismatch or ambiguity",
      { outcome: "AI_PRODUCT_FOUND_VALIDATION_REJECTED" }
    );
  }

  const deterministicConflict = deterministicAssessment?.resolution.failureReasons.some(
    reason =>
      reason === "product_conflict" ||
      reason === "variant_ambiguity" ||
      reason === "price_conflict"
  );
  if (deterministicConflict) {
    throw new LLMValidationError(
      "AI match conflicts with deterministic product evidence",
      { outcome: "AI_PRODUCT_FOUND_VALIDATION_REJECTED" }
    );
  }
}

function validateProviderResult(result: InvokeResult): void {
  try {
    const extraction = parseExtractionResponse(contentFromResult(result));
    assertValidExtraction(extraction);
  } catch (error) {
    if (error instanceof LLMValidationError) throw error;
    throw new LLMValidationError(
      error instanceof Error ? error.message : "LLM response is not valid JSON",
      {
        retryable: true,
        outcome:
          contentFromResult(result).trim().length === 0
            ? "AI_EMPTY_RESPONSE"
            : /does not match|invalid extraction value/i.test(
                  error instanceof Error ? error.message : ""
                )
              ? "AI_SCHEMA_VALIDATION_ERROR"
              : "AI_MALFORMED_JSON",
      }
    );
  }
}

function deterministicResult(
  input: ExtractionInput,
  product: DeterministicProductData,
  match = assessProductMatch(input.merchantProduct, product)
): ExtractionResult | null {
  if (!match.highConfidence || product.price == null || !product.currency)
    return null;
  return {
    isMatch: match.isMatch,
    confidence: match.confidence,
    matchConfidence: match.matchConfidence,
    skuMatchConfidence: match.skuMatchConfidence,
    titleSimilarity: match.titleSimilarity,
    variantSimilarity: match.variantSimilarity,
    price: product.price,
    currency: product.currency,
    salePrice: product.salePrice,
    originalPrice: product.originalPrice,
    title: product.title,
    description: product.description,
    features: product.features,
    reasoning: `High-confidence deterministic extraction from ${product.source}`,
    targetProductFound: match.isMatch,
    brand: product.productIdentity.brand,
    model: product.productIdentity.mpn,
    generation: null,
    capacity: null,
    variant: null,
    priceAssociation: "exact",
    productCandidates: [],
    deterministicMatch: match.deterministicMatch,
  };
}

function pendingDeterministicResult(
  input: ExtractionInput,
  product: DeterministicProductData,
  match = assessProductMatch(input.merchantProduct, product)
): ExtractionResult {
  return {
    isMatch: match.isMatch,
    confidence: Math.min(0.6, match.confidence),
    matchConfidence: match.matchConfidence,
    skuMatchConfidence: match.skuMatchConfidence,
    titleSimilarity: match.titleSimilarity,
    variantSimilarity: match.variantSimilarity,
    price: product.variantAmbiguous ? null : product.price,
    currency: product.variantAmbiguous ? "" : (product.currency ?? ""),
    salePrice: product.variantAmbiguous ? null : product.salePrice,
    originalPrice: product.variantAmbiguous ? null : product.originalPrice,
    title: product.title,
    description: product.description,
    features: product.features,
    reasoning: "Deterministic evidence preserved; AI resolution is pending",
    targetProductFound: match.isMatch,
    brand: product.productIdentity.brand,
    model: product.productIdentity.mpn,
    generation: null,
    capacity: null,
    variant: null,
    priceAssociation: product.variantAmbiguous ? "ambiguous" : "unknown",
    productCandidates: [],
    deterministicMatch: match.deterministicMatch,
  };
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractionFromRecord(record: AiExtraction): ExtractionResult {
  const metadata = record.rawResponse as {
    deterministicMatch?: unknown;
  } | null;
  return {
    isMatch: record.isMatch,
    confidence: Number(record.confidence),
    matchConfidence: Number(record.matchConfidence ?? 0),
    skuMatchConfidence: Number(record.skuMatchConfidence ?? 0),
    titleSimilarity: Number(record.titleSimilarity ?? 0),
    variantSimilarity: Number(record.variantSimilarity ?? 0),
    price: numberOrNull(record.extractedPrice),
    currency: record.extractedCurrency ?? "USD",
    salePrice: numberOrNull(record.extractedSalePrice),
    originalPrice: numberOrNull(record.extractedOriginalPrice),
    title: record.extractedTitle,
    description: record.extractedDescription,
    features: Array.isArray(record.extractedFeatures)
      ? record.extractedFeatures.map(String)
      : [],
    reasoning: record.reasoning ?? "Cached extraction",
    targetProductFound:
      typeof (metadata as { targetProductFound?: unknown } | null)
        ?.targetProductFound === "boolean"
        ? Boolean(
            (metadata as { targetProductFound?: unknown }).targetProductFound
          )
        : record.isMatch,
    brand:
      typeof (metadata as { brand?: unknown } | null)?.brand === "string"
        ? String((metadata as { brand: unknown }).brand)
        : null,
    model:
      typeof (metadata as { model?: unknown } | null)?.model === "string"
        ? String((metadata as { model: unknown }).model)
        : null,
    generation:
      typeof (metadata as { generation?: unknown } | null)?.generation ===
      "string"
        ? String((metadata as { generation: unknown }).generation)
        : null,
    capacity:
      typeof (metadata as { capacity?: unknown } | null)?.capacity === "string"
        ? String((metadata as { capacity: unknown }).capacity)
        : null,
    variant:
      typeof (metadata as { variant?: unknown } | null)?.variant === "string"
        ? String((metadata as { variant: unknown }).variant)
        : null,
    priceAssociation:
      typeof (metadata as { priceAssociation?: unknown } | null)
        ?.priceAssociation === "string"
        ? ((metadata as { priceAssociation: PriceAssociation })
            .priceAssociation ?? "unknown")
        : record.isMatch
          ? "exact"
          : "unknown",
    productCandidates: Array.isArray(
      (metadata as { productCandidates?: unknown } | null)?.productCandidates
    )
      ? ((metadata as { productCandidates: ExtractedProductCandidate[] })
          .productCandidates ?? [])
      : [],
    deterministicMatch: metadata?.deterministicMatch === true,
  };
}

async function findCachedExtraction(
  input: ExtractionInput,
  hash: string
): Promise<ValidatedExtraction | null> {
  if (!input.competitorId) return null;
  const database = await requireDb();
  const [record] = await database
    .select()
    .from(aiExtractions)
    .where(
      and(
        eq(aiExtractions.productId, input.merchantProduct.id),
        eq(aiExtractions.competitorId, input.competitorId),
        eq(aiExtractions.sourceUrl, input.competitorUrl)
      )
    )
    .orderBy(desc(aiExtractions.extractedAt))
    .limit(1);
  const metadata = record?.rawResponse as {
    contentHash?: string;
    extractorVersion?: string;
  } | null;
  if (
    !record ||
    metadata?.contentHash !== hash ||
    metadata?.extractorVersion !== EXTRACTOR_VERSION
  )
    return null;
  const extraction = extractionFromRecord(record);
  extractionMetrics.cacheHits++;
  logger.info(
    { productId: input.merchantProduct.id, sourceUrl: input.competitorUrl },
    "Reusing unchanged product extraction"
  );
  return {
    extraction,
    dbId: record.id,
    passedThreshold:
      extraction.isMatch &&
      (extraction.confidence >= ENV.matchConfidenceThreshold ||
        extraction.deterministicMatch === true),
    modelUsed: record.modelUsed,
  };
}

async function persistExtraction(options: {
  input: ExtractionInput;
  extraction: ExtractionResult;
  modelUsed: string;
  tokensUsed?: number;
  rawResponse: Record<string, unknown>;
}): Promise<ValidatedExtraction> {
  const { input, extraction } = options;
  if (!input.competitorId) {
    throw new ExtractionPipelineError(
      "DETERMINISTIC_EXTRACTION_FAILED",
      "A competitor connection is required to persist an extraction"
    );
  }
  const database = await requireDb();
  const [record] = await database
    .insert(aiExtractions)
    .values({
      productId: input.merchantProduct.id,
      competitorId: input.competitorId,
      sourceUrl: input.competitorUrl,
      isMatch: extraction.isMatch,
      confidence: extraction.confidence,
      matchConfidence: extraction.matchConfidence,
      skuMatchConfidence: extraction.skuMatchConfidence,
      titleSimilarity: extraction.titleSimilarity,
      variantSimilarity: extraction.variantSimilarity,
      extractedPrice:
        extraction.price != null ? String(extraction.price) : null,
      extractedCurrency: extraction.currency || null,
      extractedSalePrice:
        extraction.salePrice != null ? String(extraction.salePrice) : null,
      extractedOriginalPrice:
        extraction.originalPrice != null
          ? String(extraction.originalPrice)
          : null,
      extractedTitle: extraction.title,
      extractedDescription: extraction.description,
      extractedFeatures: extraction.features,
      reasoning: extraction.reasoning,
      modelUsed: options.modelUsed,
      tokensUsed: options.tokensUsed,
      rawResponse: options.rawResponse,
    })
    .returning();
  const passedThreshold =
    extraction.isMatch &&
    (extraction.confidence >= ENV.matchConfidenceThreshold ||
      extraction.deterministicMatch === true);
  return {
    extraction,
    dbId: record.id,
    passedThreshold,
    modelUsed: options.modelUsed,
  };
}

async function recordLearningFailure(options: {
  input: ExtractionInput;
  hash: string;
  deterministic: DeterministicProductData | null;
  matchAssessment: ProductMatchAssessment | null;
  reducedContent: string;
  aiDecision?: unknown;
}) {
  try {
    const record = await extractionFailureIntelligenceService.recordFailure({
      productId: options.input.merchantProduct.id,
      competitorId: options.input.competitorId,
      domain: options.input.competitorDomain,
      sourceUrl: options.input.competitorUrl,
      contentHash: options.hash,
      reducedContent: options.reducedContent,
      pageContentForFingerprint: options.input.competitorPageContent,
      deterministic: options.deterministic,
      matchAssessment: options.matchAssessment,
      aiDecision: options.aiDecision,
    });
    if (jobQueueService.isEnabled) {
      void jobQueueService.enqueueAiAnalysis(record.id).catch(error => {
        logger.warn(
          { failureId: record.id, err: error },
          "Could not enqueue asynchronous scraper improvement analysis"
        );
      });
    }
  } catch (error) {
    logger.warn(
      { productId: options.input.merchantProduct.id, err: error },
      "Could not persist scraper learning signal"
    );
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const aiExtractionService = {
  async extractAndValidate(
    input: ExtractionInput
  ): Promise<ValidatedExtraction> {
    const hash = contentHash(input.competitorPageContent);
    const key = [
      input.merchantProduct.id,
      input.competitorId ?? "unpersisted",
      input.competitorUrl,
      hash,
    ].join(":");

    return deduplicateExtraction(key, async () => {
      const cached = await findCachedExtraction(input, hash);
      if (cached) return cached;

      const learningContext = {
        domain: normalizeFailureDomain(
          input.competitorDomain,
          input.competitorUrl
        ),
        platform: fingerprintStorefront(input.competitorPageContent).platform,
      };

      const deterministic = extractDeterministicProduct(
        input.competitorPageContent,
        { pageUrl: input.competitorUrl }
      );
      const matchAssessment = deterministic
        ? assessProductMatch(input.merchantProduct, deterministic)
        : null;
      extractionMetrics.deterministicAttempts++;
      if (deterministic) {
        extractionMetrics.deterministicSources[deterministic.source] =
          (extractionMetrics.deterministicSources[deterministic.source] ?? 0) +
          1;
        if (deterministic.priceConflict) {
          extractionMetrics.priceConflicts++;
          logger.warn(
            {
              productId: input.merchantProduct.id,
              source: deterministic.source,
            },
            "Deterministic price candidates conflict; applying authority rules"
          );
        }
        if (deterministic.variantAmbiguous) {
          extractionMetrics.variantAmbiguities++;
          logger.info(
            { productId: input.merchantProduct.id },
            "Deterministic variant selection is ambiguous"
          );
        }
        const state = matchAssessment?.resolution.state ?? "unresolved";
        extractionMetrics.resolutionStates[state] =
          (extractionMetrics.resolutionStates[state] ?? 0) + 1;
        if (state === "ambiguous") extractionMetrics.ambiguousExtractions++;
        if (state === "unresolved") extractionMetrics.unresolvedExtractions++;
        for (const reason of matchAssessment?.resolution.failureReasons ?? []) {
          extractionMetrics.failureReasons[reason] =
            (extractionMetrics.failureReasons[reason] ?? 0) + 1;
        }
      } else {
        extractionMetrics.resolutionStates.unresolved =
          (extractionMetrics.resolutionStates.unresolved ?? 0) + 1;
        extractionMetrics.unresolvedExtractions++;
      }
      const extraction = deterministic
        ? deterministicResult(
            input,
            deterministic,
            matchAssessment ?? undefined
          )
        : null;

      if (extraction && deterministic) {
        extractionMetrics.deterministicSuccesses++;
        extractionMetrics.highConfidenceSaves++;
        logger.info(
          {
            productId: input.merchantProduct.id,
            source: deterministic.source,
            confidence: extraction.confidence,
          },
          "Product extracted without LLM"
        );
        return persistExtraction({
          input,
          extraction,
          modelUsed: `deterministic:${deterministic.source}`,
          rawResponse: {
            contentHash: hash,
            extractionSource: deterministic.source,
            deterministic: true,
            deterministicMatch: extraction.deterministicMatch === true,
            ...learningContext,
            extractorVersion: deterministic.extractorVersion,
            resolution: matchAssessment?.resolution,
            evidence: deterministic.evidence,
            productEvidence: deterministic.productEvidence,
            variantEvidence: deterministic.variantEvidence,
            priceEvidence: deterministic.priceEvidence,
            priceCandidates: deterministic.priceCandidates.slice(0, 20),
            priceConflict: deterministic.priceConflict,
            variantAmbiguous: deterministic.variantAmbiguous,
            targetProductFound: extraction.targetProductFound,
            brand: extraction.brand,
            model: extraction.model,
            generation: extraction.generation,
            capacity: extraction.capacity,
            variant: extraction.variant,
            priceAssociation: extraction.priceAssociation,
            productCandidates: extraction.productCandidates,
          },
        });
      }

      const reducedContent = reduceProductContent(
        input.competitorPageContent,
        ENV.llmContentMaxChars,
        deterministic
      );
      extractionMetrics.llmRequests++;
      extractionMetrics.contentCharsBefore +=
        input.competitorPageContent.length;
      extractionMetrics.contentCharsAfter += reducedContent.length;
      logger.info(
        {
          productId: input.merchantProduct.id,
          contentCharsBefore: input.competitorPageContent.length,
          contentCharsAfter: reducedContent.length,
          deterministicSource: deterministic?.source ?? null,
        },
        "Product requires AI extraction"
      );

      const promptInput = {
        ...input,
        competitorPageContent: reducedContent,
      };
      const { system, user } = buildExtractionPrompt(promptInput);
      let lastLLMResult: InvokeResult | undefined;

      try {
        const result = await invokeLLMWithFallback({
          provider: "openrouter",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          outputSchema: EXTRACTION_SCHEMA,
          maxRetries: 1,
          maxTokens: 2048,
          resultValidator: result => {
            validateProviderResult(result);
            assertAiIdentityConsistency(
              parseExtractionResponse(contentFromResult(result)),
              matchAssessment
            );
          },
        });
        lastLLMResult = result;
        const rawContent = contentFromResult(result);
        const llmExtraction = parseExtractionResponse(rawContent);
        assertValidExtraction(llmExtraction);
        assertAiIdentityConsistency(llmExtraction, matchAssessment);
        const outcome = persistedOutcome(llmExtraction);
        recordOutcome(outcome);
        extractionMetrics.llmSuccesses++;

        const persisted = await persistExtraction({
          input,
          extraction: llmExtraction,
          modelUsed: result.actualModel ?? result.model,
          tokensUsed: result.usage?.total_tokens,
          rawResponse: {
            content: safeModelContent(rawContent),
            contentHash: hash,
            extractionSource: "llm",
            provider: "openrouter",
            aiStatus: "success",
            status: "AI_SUCCESS",
            aiModel: result.actualModel ?? result.model,
            requestedModel: result.requestedModel ?? ENV.openrouterModel,
            actualModel: result.actualModel ?? null,
            outcome,
            candidateUrl: input.competitorUrl,
            productId: input.merchantProduct.id,
            candidateTitle: input.candidateTitle ?? null,
            pageClassification: input.pageClassification ?? null,
            confidence: llmExtraction.confidence,
            targetProductFound: llmExtraction.targetProductFound,
            brand: llmExtraction.brand,
            model: llmExtraction.model,
            generation: llmExtraction.generation,
            capacity: llmExtraction.capacity,
            variant: llmExtraction.variant,
            priceAssociation: llmExtraction.priceAssociation,
            productCandidates: llmExtraction.productCandidates,
            structuredOutputValid: true,
            ...learningContext,
            extractorVersion:
              deterministic?.extractorVersion ?? EXTRACTOR_VERSION,
            deterministicResolution: matchAssessment?.resolution ?? null,
            deterministicEvidence: deterministic?.evidence ?? [],
            productEvidence: deterministic?.productEvidence ?? [],
            variantEvidence: deterministic?.variantEvidence ?? [],
            priceEvidence: deterministic?.priceEvidence ?? [],
            contentCharsBefore: input.competitorPageContent.length,
            contentCharsAfter: reducedContent.length,
          },
        });
        logger.info(
          {
            productId: input.merchantProduct.id,
            model: result.model,
            isMatch: llmExtraction.isMatch,
            confidence: llmExtraction.confidence,
            passedThreshold: persisted.passedThreshold,
          },
          "AI extraction completed"
        );
        await recordLearningFailure({
          input,
          hash,
          deterministic,
          matchAssessment,
          reducedContent,
          aiDecision: {
            status: "resolved",
            model: result.actualModel ?? result.model,
            requestedModel: result.requestedModel ?? ENV.openrouterModel,
            actualModel: result.actualModel ?? null,
            outcome,
            extraction: llmExtraction,
          },
        });
        return persisted;
      } catch (error) {
        extractionMetrics.llmFailures++;
        const failureCategory = aiFailureCategory(error);
        const outcome =
          lastLLMResult && contentFromResult(lastLLMResult).trim().length === 0
            ? "AI_EMPTY_RESPONSE"
            : aiFailureOutcome(error);
        const attempts = llmAttemptDiagnostics(error);
        recordOutcome(outcome);
        if (deterministic && input.competitorId) {
          const pending = pendingDeterministicResult(
            input,
            deterministic,
            matchAssessment ?? undefined
          );
          const persisted = await persistExtraction({
            input,
            extraction: pending,
            modelUsed: "deterministic:pending-ai",
            rawResponse: {
              contentHash: hash,
              extractionSource: "deterministic-pending-ai",
              provider: "openrouter",
              aiStatus: "error",
              status: outcome,
              aiErrorCategory: failureCategory,
              outcome,
              requestedModel:
                lastLLMResult?.requestedModel ??
                ENV.openrouterModels[0] ??
                ENV.openrouterModel,
              requestedModels:
                ENV.openrouterModels.length > 0
                  ? [...ENV.openrouterModels]
                  : [ENV.openrouterModel],
              actualModel:
                lastLLMResult?.actualModel ??
                (attempts.length === 1 ? attempts[0].actualModel ?? null : null),
              candidateUrl: input.competitorUrl,
              productId: input.merchantProduct.id,
              candidateTitle: input.candidateTitle ?? null,
              pageClassification: input.pageClassification ?? null,
              aiConfidence: null,
              attempts,
              structuredOutputValid: false,
              ...learningContext,
              extractorVersion: deterministic.extractorVersion,
              needsAi: true,
              deterministicMatch: pending.deterministicMatch === true,
              resolution: matchAssessment?.resolution,
              evidence: deterministic.evidence,
              productEvidence: deterministic.productEvidence,
              variantEvidence: deterministic.variantEvidence,
              priceEvidence: deterministic.priceEvidence,
              priceCandidates: deterministic.priceCandidates.slice(0, 20),
              priceConflict: deterministic.priceConflict,
              variantAmbiguous: deterministic.variantAmbiguous,
            },
          });
          logger.warn(
            {
              productId: input.merchantProduct.id,
              reason: "ai_unavailable",
              provider: "openrouter",
              aiErrorCategory: failureCategory,
              source: deterministic.source,
            },
            "Preserved deterministic evidence while AI extraction is pending"
          );
          await recordLearningFailure({
            input,
            hash,
            deterministic,
            matchAssessment,
            reducedContent,
            aiDecision: {
              status: "failed",
              category: failureCategory,
              outcome,
              attempts,
            },
          });
          return persisted;
        }
        await recordLearningFailure({
          input,
          hash,
          deterministic,
          matchAssessment,
          reducedContent,
          aiDecision: {
            status: "failed",
            category: failureCategory,
            outcome,
            attempts,
          },
        });
        const validationOnlyFailure =
          error instanceof AllLLMModelsFailedError &&
          error.attempts.length > 0 &&
          error.attempts.every(
            attempt => attempt.category === "validation_failed"
          );
        if (error instanceof LLMValidationError || validationOnlyFailure) {
          throw new ExtractionPipelineError(
            "LLM_VALIDATION_FAILED",
            "AI extraction returned invalid structured data",
            error
          );
        }
        throw new ExtractionPipelineError(
          "ALL_LLM_MODELS_FAILED",
          failureCategory === "configuration_error"
            ? error instanceof AllLLMModelsFailedError
              ? error.message
              : "AI extraction unavailable: OPENROUTER_API_KEY is not configured"
            : "All AI extraction models are currently unavailable",
          error
        );
      }
    });
  },

  async getExtractions(
    userId: string,
    options?: {
      productId?: string;
      isMatch?: boolean;
      minConfidence?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<AiExtraction[]> {
    const database: any = await requireDb();
    const conditions: any[] = [];

    if (options?.productId) {
      const product = await database.query.products.findFirst({
        where: and(
          eq(products.id, options.productId),
          eq(products.userId, userId)
        ),
      });
      if (!product) return [];
      conditions.push(eq(aiExtractions.productId, options.productId));
    }

    if (options?.isMatch !== undefined)
      conditions.push(eq(aiExtractions.isMatch, options.isMatch));

    return database
      .select()
      .from(aiExtractions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(aiExtractions.extractedAt))
      .limit(Math.min(options?.limit ?? 50, 200))
      .offset(options?.offset ?? 0);
  },

  async getLatestExtraction(
    productId: string,
    competitorId: string
  ): Promise<AiExtraction | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(aiExtractions)
      .where(
        and(
          eq(aiExtractions.productId, productId),
          eq(aiExtractions.competitorId, competitorId)
        )
      )
      .orderBy(desc(aiExtractions.extractedAt))
      .limit(1);
    return result[0];
  },
};
