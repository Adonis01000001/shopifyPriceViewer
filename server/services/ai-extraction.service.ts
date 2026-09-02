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
  };
  competitorPageContent: string;
  competitorUrl: string;
  competitorDomain: string;
  competitorId?: string;
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
};

export function getExtractionMetrics() {
  const reductions = extractionMetrics.llmRequests || 1;
  return {
    ...extractionMetrics,
    deterministicSources: { ...extractionMetrics.deterministicSources },
    resolutionStates: { ...extractionMetrics.resolutionStates },
    failureReasons: { ...extractionMetrics.failureReasons },
    llmExtractionPercentage:
      extractionMetrics.llmRequests /
      Math.max(1, extractionMetrics.deterministicAttempts),
    averageContentCharsBefore:
      extractionMetrics.contentCharsBefore / reductions,
    averageContentCharsAfter: extractionMetrics.contentCharsAfter / reductions,
  };
}

// ─── JSON Schema for Structured Output ───────────────────────────────────────

const EXTRACTION_SCHEMA = {
  name: "product_extraction",
  schema: {
    type: "object",
    properties: {
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
      price: { type: "number", description: "Current selling price" },
      currency: {
        type: "string",
        description: "Currency code (USD, EUR, GBP)",
      },
      salePrice: {
        type: "number",
        description: "Sale price if on sale, null if not",
      },
      originalPrice: {
        type: "number",
        description: "Original price before discount, null if not on sale",
      },
      title: {
        type: "string",
        description: "Product title from competitor page",
      },
      description: {
        type: "string",
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
    },
    required: [
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
    ],
  },
  strict: true,
} as const;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildExtractionPrompt(input: ExtractionInput): {
  system: string;
  user: string;
} {
  const { merchantProduct, competitorPageContent, competitorUrl } = input;

  const system = `Return ONLY a single JSON object with EXACTLY these top-level keys and no others:
isMatch (boolean), confidence (0-1), matchConfidence (0-1), skuMatchConfidence (0-1), titleSimilarity (0-1), variantSimilarity (0-1), price (number or null), currency (string), salePrice (number or null), originalPrice (number or null), title (string or null), description (string or null), features (array of strings), reasoning (string).
Do not nest these under any other key. Do not wrap them in objects such as "match" or "competitor". Do not add commentary before or after the JSON.
"price" MUST be a number you literally read on the competitor page. If the page shows no price, set price to null. Never copy the merchant's own price.

You are a product matching and price extraction AI. Analyze a competitor's product page and determine if it matches the merchant's product, then extract structured data.

Rules:
- The merchant product identity above is authoritative. Extract only the competitor listing for that exact product and requested variant.
- Compare brand, model, SKU, storage, color, size, and variant details carefully.
- iPhone 14 Blue 128GB MATCHES iPhone 14 Blue 128GB.
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Black 128GB (different color).
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Blue 256GB (different storage).
- iPhone 14 DOES NOT MATCH iPhone 15 (different model).
- Related products, recommendations, accessories, bundles, and navigation prices are not the target product.
- Subscription, member, recurring, installment, shipping, and per-unit prices are not the target price unless the requested product itself is that subscription or unit-based product.
- Extract the price for the requested product/variant only. Do not use the first price on the page.
- Prefer a clearly identified sale price as the current price; keep compare-at/original price separate and never substitute it for the current price.
- Do not infer or calculate a price that is not explicitly supported by the supplied page content.
- If exact identity, variant, currency, or current price cannot be established with sufficient confidence, set isMatch to false and price to null rather than guessing.
- Extract current price, sale price (if on sale), and original price.
- Return ONLY valid JSON matching the schema. No markdown.`;

  const user = `## Merchant Product
Title: ${merchantProduct.title}
Brand: ${merchantProduct.vendor ?? "Unknown"}
SKU: ${merchantProduct.sku ?? "N/A"}
Barcode: ${merchantProduct.barcode ?? "N/A"}
Category: ${merchantProduct.category ?? "N/A"}
Current Price: ${merchantProduct.price ?? "N/A"}
Description: ${(merchantProduct.description ?? "").slice(0, 500)}

## Competitor Page URL
${competitorUrl}

## Competitor Page Content
${competitorPageContent}

## Task
1. Determine if the competitor product is an EXACT MATCH for the merchant product.
2. Extract the price, currency, sale price, original price.
3. Extract the product title, description, and key features.
4. Provide confidence scores for each aspect.
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
  const required = [
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
  ];
  if (
    !parsed ||
    typeof parsed !== "object" ||
    required.some(key => !Object.prototype.hasOwnProperty.call(parsed, key)) ||
    typeof parsed.isMatch !== "boolean" ||
    typeof parsed.currency !== "string" ||
    typeof parsed.reasoning !== "string" ||
    !Array.isArray(parsed.features) ||
    parsed.features.some((feature: unknown) => typeof feature !== "string")
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
    deterministicMatch: false,
  };
}

function contentFromResult(result: InvokeResult): string {
  const content = result.choices[0]?.message?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
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
      "Extraction contains invalid confidence scores"
    );
  }
  for (const price of [
    extraction.price,
    extraction.salePrice,
    extraction.originalPrice,
  ]) {
    if (price != null && (!Number.isFinite(price) || price <= 0)) {
      throw new LLMValidationError("Extraction contains an invalid price");
    }
  }
  if (!/^[A-Z]{3}$/.test(extraction.currency)) {
    throw new LLMValidationError(
      "Extraction contains an invalid currency code"
    );
  }
  if (extraction.price != null && !extraction.title) {
    throw new LLMValidationError(
      "Extraction with a price must include a product title"
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
      error instanceof Error ? error.message : "LLM response is not valid JSON"
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

      try {
        const result = await invokeLLMWithFallback({
          provider: "openai",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          outputSchema: EXTRACTION_SCHEMA,
          maxTokens: 2048,
          resultValidator: validateProviderResult,
        });
        const rawContent = contentFromResult(result);
        const llmExtraction = parseExtractionResponse(rawContent);
        assertValidExtraction(llmExtraction);
        extractionMetrics.llmSuccesses++;

        const persisted = await persistExtraction({
          input,
          extraction: llmExtraction,
          modelUsed: result.model,
          tokensUsed: result.usage?.total_tokens,
          rawResponse: {
            content: rawContent,
            contentHash: hash,
            extractionSource: "llm",
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
            model: result.model,
            extraction: llmExtraction,
          },
        });
        return persisted;
      } catch (error) {
        extractionMetrics.llmFailures++;
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
              category:
                error instanceof LLMValidationError
                  ? "validation_failed"
                  : "all_models_failed",
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
            category:
              error instanceof LLMValidationError
                ? "validation_failed"
                : "all_models_failed",
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
          "All AI extraction models are currently unavailable",
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
