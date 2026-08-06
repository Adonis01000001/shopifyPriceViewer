import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { requireDb } from "../_core/db-assert";
import { productService } from "./product.service";
import { pricingEngine } from "./pricing-engine.service";
import { recommendationService } from "./recommendation.service";
import {
  products,
  competitors,
  competitorProducts,
  serpApiScouts,
  pathOfWisdomResults,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export interface WisdomProductInput {
  id: string;
  title: string;
  sku: string | null;
  category: string | null;
  price: number;
  costPrice: number | null;
  vendor: string | null;
  status: string;
  competitorCount: number;
  avgCompetitorPrice: number | null;
  lowestCompetitorPrice: number | null;
  highestCompetitorPrice: number | null;
  competitorNames: string[];
}

export interface WisdomProductRecommendation {
  productId: string;
  productTitle: string;
  currentPrice: number;
  recommendedPrice: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  marketContext: string;
  riskFactors: string[];
  priceChange: number;
  priceChangePercent: number;
}

export interface WisdomAnalysis {
  summary: string;
  overallMarketContext: string;
  topOpportunities: string[];
  keyRisks: string[];
  productRecommendations: WisdomProductRecommendation[];
}

export interface WisdomAnalysisResult {
  analysis: WisdomAnalysis | null;
  error: string | null;
  productCount: number;
}

export interface SavedWisdomAnalysis {
  analysis: WisdomAnalysis;
  error: null;
  productCount: number;
  savedAt: Date;
}

function buildProductsContext(products: WisdomProductInput[]): string {
  return products
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title}
  SKU: ${p.sku ?? "N/A"}
  Category: ${p.category ?? "N/A"}
  Current Price: $${p.price.toFixed(2)}
  Cost Price: ${p.costPrice != null ? `$${p.costPrice.toFixed(2)}` : "N/A"}
  Status: ${p.status}
  Competitors Tracked: ${p.competitorCount}
  Avg Competitor Price: ${p.avgCompetitorPrice != null ? `$${p.avgCompetitorPrice.toFixed(2)}` : "N/A"}
  Price Range: ${p.lowestCompetitorPrice != null ? `$${p.lowestCompetitorPrice.toFixed(2)}` : "N/A"} - ${p.highestCompetitorPrice != null ? `$${p.highestCompetitorPrice.toFixed(2)}` : "N/A"}
  Competitors: ${p.competitorNames.join(", ") || "None yet"}`
    )
    .join("\n\n");
}

function buildPrompt(products: WisdomProductInput[]): string {
  const productCount = products.length;
  const totalCompetitors = new Set(products.flatMap(p => p.competitorNames)).size;

  return `You are a senior pricing strategist. Analyze this merchant's product portfolio and provide strategic pricing recommendations.

PORTFOLIO OVERVIEW:
- Total Products: ${productCount}
- Products with Competitor Data: ${products.filter(p => p.competitorCount > 0).length}
- Unique Competitors Identified: ${totalCompetitors}
- Products with Cost Info: ${products.filter(p => p.costPrice != null && p.costPrice > 0).length}

PRODUCT DETAILS:
${buildProductsContext(products)}

Provide a comprehensive pricing strategy analysis in valid JSON only:
{
  "summary": "2-3 sentence executive summary of the portfolio's pricing health",
  "overallMarketContext": "one paragraph describing the competitive landscape across all products",
  "topOpportunities": ["3-5 specific, actionable pricing opportunities"],
  "keyRisks": ["3-5 pricing risks or threats"],
  "productRecommendations": [
    {
      "productIndex": <number matching the product number above>,
      "recommendedPrice": <optimal price as number>,
      "confidence": "<low|medium|high>",
      "reasoning": "2-3 sentence explanation",
      "marketContext": "one sentence about this product's market position",
      "riskFactors": ["1-3 specific risks for this product"]
    }
  ]
}`;
}

function parseAnalysis(raw: string, products: WisdomProductInput[]): WisdomAnalysis | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    const productRecs: WisdomProductRecommendation[] = [];
    if (Array.isArray(parsed.productRecommendations)) {
      for (const rec of parsed.productRecommendations) {
        const idx = rec.productIndex - 1;
        const product = products[idx];
        if (!product) continue;

        const recommendedPrice = Number(rec.recommendedPrice);
        if (!isFinite(recommendedPrice) || recommendedPrice <= 0) continue;

        const priceChange = recommendedPrice - product.price;
        const priceChangePercent = product.price > 0
          ? (priceChange / product.price) * 100
          : 0;

        productRecs.push({
          productId: product.id,
          productTitle: product.title,
          currentPrice: product.price,
          recommendedPrice,
          confidence: ["low", "medium", "high"].includes(rec.confidence) ? rec.confidence : "medium",
          reasoning: String(rec.reasoning ?? ""),
          marketContext: String(rec.marketContext ?? ""),
          riskFactors: Array.isArray(rec.riskFactors) ? rec.riskFactors : [],
          priceChange,
          priceChangePercent,
        });
      }
    }

    return {
      summary: String(parsed.summary ?? ""),
      overallMarketContext: String(parsed.overallMarketContext ?? ""),
      topOpportunities: Array.isArray(parsed.topOpportunities) ? parsed.topOpportunities : [],
      keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks : [],
      productRecommendations: productRecs,
    };
  } catch {
    return null;
  }
}

async function fetchCompetitorPrices(productId: string): Promise<{
  prices: number[];
  names: string[];
  lowest: number | null;
  highest: number | null;
  avg: number | null;
}> {
  const database = await requireDb();
  const rows = await database
    .select({
      price: competitorProducts.price,
      name: competitors.name,
    })
    .from(competitorProducts)
    .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
    .where(
      and(
        eq(competitorProducts.productId, productId),
        eq(competitorProducts.isActive, true)
      )
    );

  const prices = rows.map(r => Number(r.price)).filter(p => p > 0);
  const names = Array.from(new Set(rows.map(r => r.name)));

  return {
    prices,
    names,
    lowest: prices.length > 0 ? Math.min(...prices) : null,
    highest: prices.length > 0 ? Math.max(...prices) : null,
    avg: prices.length > 0
      ? Math.round((prices.reduce((a, p) => a + p, 0) / prices.length) * 100) / 100
      : null,
  };
}

export async function analyzePortfolio(
  userId: string
): Promise<WisdomAnalysisResult> {
  const userProducts = await productService.getByUserId(userId);
  const tracked = userProducts.filter(p => p.isTracked && p.isActive);

  if (tracked.length === 0) {
    return { analysis: null, error: "No tracked products found", productCount: 0 };
  }

  const productInputs: WisdomProductInput[] = [];

  for (const product of tracked) {
    const compData = await fetchCompetitorPrices(product.id);
    productInputs.push({
      id: product.id,
      title: product.title,
      sku: product.sku,
      category: product.category,
      price: Number(product.price),
      costPrice: product.costPrice != null ? Number(product.costPrice) : null,
      vendor: product.vendor,
      status: product.status,
      competitorCount: compData.prices.length,
      avgCompetitorPrice: compData.avg,
      lowestCompetitorPrice: compData.lowest,
      highestCompetitorPrice: compData.highest,
      competitorNames: compData.names,
    });
  }

  const prompt = buildPrompt(productInputs);

  const isOpenRouter = !!ENV.openrouterApiKey;
  if (!isOpenRouter && !ENV.openaiApiKey) {
    return { analysis: null, error: "No LLM API key configured", productCount: tracked.length };
  }

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a senior pricing strategist for e-commerce. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 4096,
      ...(isOpenRouter
        ? { baseUrl: ENV.openrouterBaseUrl, apiKey: ENV.openrouterApiKey }
        : {}),
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { analysis: null, error: "Empty LLM response", productCount: tracked.length };
    }

    const analysis = parseAnalysis(content, productInputs);
    if (!analysis) {
      return { analysis: null, error: "Failed to parse LLM response", productCount: tracked.length };
    }

    try {
      await recommendationService.upsertWisdomRecommendations(
        userId,
        analysis.productRecommendations
      );
    } catch (err) {
      logger.warn({ err, userId }, "Failed to persist Path of Wisdom recommendations");
    }

    logger.info(
      { productCount: tracked.length, recommendations: analysis.productRecommendations.length },
      "Wisdom analysis completed"
    );

    return { analysis, error: null, productCount: tracked.length };
  } catch (err) {
    logger.error({ err }, "Wisdom analysis failed");
    return { analysis: null, error: "AI analysis failed", productCount: tracked.length };
  }
}

/**
 * Read the latest successful result for a user. Failed runs are never stored,
 * so this remains the last known-good output across sessions and devices.
 */
export async function getLatestWisdomAnalysis(
  userId: string
): Promise<SavedWisdomAnalysis | null> {
  const database = await requireDb();
  const [saved] = await database
    .select()
    .from(pathOfWisdomResults)
    .where(eq(pathOfWisdomResults.userId, userId))
    .limit(1);

  if (!saved) return null;

  return {
    analysis: saved.output as WisdomAnalysis,
    error: null,
    productCount: saved.productCount,
    savedAt: saved.updatedAt,
  };
}

/**
 * Replace the user's latest result atomically after a successful analysis.
 * The caller must only pass a result with a non-null analysis.
 */
export async function saveWisdomAnalysis(
  userId: string,
  result: WisdomAnalysisResult
): Promise<SavedWisdomAnalysis> {
  if (result.error || !result.analysis) {
    throw new Error("Only successful Path of Wisdom results can be saved");
  }

  const database = await requireDb();
  const now = new Date();

  await database
    .insert(pathOfWisdomResults)
    .values({
      userId,
      output: result.analysis,
      productCount: result.productCount,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pathOfWisdomResults.userId,
      set: {
        output: result.analysis,
        productCount: result.productCount,
        updatedAt: now,
      },
    });

  const saved = await getLatestWisdomAnalysis(userId);
  if (!saved) {
    throw new Error("Path of Wisdom result was not available after saving");
  }

  return saved;
}
