import { eq, and, desc } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  aiExtractions,
  products,
  type AiExtraction,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";

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
}

export interface ValidatedExtraction {
  extraction: ExtractionResult;
  dbId: string;
  passedThreshold: boolean;
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

  const system = `You are a product matching and price extraction AI. Analyze a competitor's product page and determine if it matches the merchant's product, then extract structured data.

Rules:
- Compare brand, model, SKU, storage, color, size, and variant details carefully.
- iPhone 14 Blue 128GB MATCHES iPhone 14 Blue 128GB.
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Black 128GB (different color).
- iPhone 14 Blue 128GB DOES NOT MATCH iPhone 14 Blue 256GB (different storage).
- iPhone 14 DOES NOT MATCH iPhone 15 (different model).
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
${competitorPageContent.slice(0, 8000)}

## Task
1. Determine if the competitor product is an EXACT MATCH for the merchant product.
2. Extract the price, currency, sale price, original price.
3. Extract the product title, description, and key features.
4. Provide confidence scores for each aspect.
5. Return structured JSON only.`;

  return { system, user };
}

// ─── Response Parser ─────────────────────────────────────────────────────────

function parseExtractionResponse(raw: string): ExtractionResult {
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  const parsed = JSON.parse(jsonStr);

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
    currency: String(parsed.currency || "USD").toUpperCase(),
    salePrice: parsed.salePrice != null ? Number(parsed.salePrice) : null,
    originalPrice:
      parsed.originalPrice != null ? Number(parsed.originalPrice) : null,
    title: parsed.title ? String(parsed.title) : null,
    description: parsed.description ? String(parsed.description) : null,
    features: Array.isArray(parsed.features) ? parsed.features.map(String) : [],
    reasoning: String(parsed.reasoning || ""),
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const aiExtractionService = {
  async extractAndValidate(
    input: ExtractionInput
  ): Promise<ValidatedExtraction> {
    const { system, user } = buildExtractionPrompt(input);

    const result = await invokeLLM({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      outputSchema: EXTRACTION_SCHEMA,
      maxTokens: 2048,
    });

    const content = result.choices[0]?.message?.content;
    const rawContent =
      typeof content === "string" ? content : JSON.stringify(content ?? "");
    let extraction: ExtractionResult;

    try {
      extraction = parseExtractionResponse(rawContent);
    } catch (parseErr) {
      logger.error(
        { parseErr, raw: rawContent.slice(0, 500) },
        "Failed to parse AI extraction response"
      );
      throw new Error("AI extraction returned invalid JSON");
    }

    const database = await requireDb();
    const insertData: Record<string, unknown> = {
      productId: input.merchantProduct.id,
      competitorId: "",
      sourceUrl: input.competitorUrl,
      isMatch: extraction.isMatch,
      confidence: String(extraction.confidence),
      matchConfidence: String(extraction.matchConfidence),
      skuMatchConfidence: String(extraction.skuMatchConfidence),
      titleSimilarity: String(extraction.titleSimilarity),
      variantSimilarity: String(extraction.variantSimilarity),
      extractedPrice:
        extraction.price != null ? String(extraction.price) : null,
      extractedCurrency: extraction.currency,
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
      modelUsed: result.model,
      tokensUsed: result.usage?.total_tokens,
      rawResponse: { content: rawContent },
    };
    const [record] = await database
      .insert(aiExtractions)
      .values(insertData as any)
      .returning();

    const passedThreshold =
      extraction.isMatch &&
      extraction.confidence >= ENV.matchConfidenceThreshold;

    logger.info(
      {
        productId: input.merchantProduct.id,
        isMatch: extraction.isMatch,
        confidence: extraction.confidence,
        passedThreshold,
      },
      "AI extraction completed"
    );

    return { extraction, dbId: record.id, passedThreshold };
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
