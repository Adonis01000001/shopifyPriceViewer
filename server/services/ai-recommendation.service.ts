import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import type { MarketPositionStatus, PricingRecommendation } from "./pricing-engine.service";

export interface AiRecommendationInput {
  productTitle: string;
  productCategory: string | null;
  merchantPrice: number;
  costPrice: number | null;
  competitorCount: number;
  competitorPrices: Array<{ name: string; price: number }>;
  marketPosition: MarketPositionStatus;
  avgCompetitorPrice: number | null;
}

export interface AiRecommendationResult {
  recommendedPrice: number;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  marketContext: string;
  riskFactors: string[];
}

function buildPrompt(input: AiRecommendationInput): string {
  const lines: string[] = [
    "You are a pricing strategist. Analyze this product's market and recommend an optimal price.",
    "",
    `Product: ${input.productTitle}`,
    `Category: ${input.productCategory ?? "N/A"}`,
    `Current Price: $${input.merchantPrice.toFixed(2)}`,
  ];

  if (input.costPrice != null && input.costPrice > 0) {
    lines.push(`Cost Price: $${input.costPrice.toFixed(2)}`);
  }

  lines.push(`Market Position: ${input.marketPosition}`);
  lines.push(`Competitors tracked: ${input.competitorCount}`);

  if (input.avgCompetitorPrice != null) {
    lines.push(`Average Competitor Price: $${input.avgCompetitorPrice.toFixed(2)}`);
  }

  if (input.competitorPrices.length > 0) {
    lines.push("", "Competitor Prices:");
    for (const cp of input.competitorPrices) {
      lines.push(`  - ${cp.name}: $${cp.price.toFixed(2)}`);
    }
  }

  lines.push(
    "",
    'Respond with valid JSON only — no markdown, no extra text:',
    '{',
    '  "recommendedPrice": <number>,',
    '  "reasoning": "<2-3 sentence explanation of the price recommendation>",',
    '  "confidence": "<low|medium|high>",',
    '  "marketContext": "<one sentence summary of the competitive landscape>",',
    '  "riskFactors": ["<risk factor 1>", "<risk factor 2>"]',
    '}'
  );

  return lines.join("\n");
}

function parseResponse(raw: string): AiRecommendationResult | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    const recommendedPrice = Number(parsed.recommendedPrice);
    if (!isFinite(recommendedPrice) || recommendedPrice <= 0) return null;

    return {
      recommendedPrice,
      reasoning: String(parsed.reasoning ?? ""),
      confidence: ["low", "medium", "high"].includes(parsed.confidence)
        ? parsed.confidence
        : "medium",
      marketContext: String(parsed.marketContext ?? ""),
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
    };
  } catch {
    return null;
  }
}

export async function getAiRecommendation(
  input: AiRecommendationInput
): Promise<AiRecommendationResult | null> {
  if (!ENV.openrouterApiKey && !ENV.openaiApiKey) {
    logger.warn("No API key configured for AI recommendations");
    return null;
  }

  const isOpenRouter = !!ENV.openrouterApiKey;
  const prompt = buildPrompt(input);

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a pricing strategist. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      maxTokens: 1024,
      ...(isOpenRouter
        ? {
            baseUrl: ENV.openrouterBaseUrl,
            apiKey: ENV.openrouterApiKey,
          }
        : {}),
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    const parsed = parseResponse(content);
    if (parsed) {
      logger.info(
        { product: input.productTitle, recommendedPrice: parsed.recommendedPrice, confidence: parsed.confidence, model: result.model },
        "AI recommendation generated"
      );
    }

    return parsed;
  } catch (err) {
    logger.error({ err }, "AI recommendation failed");
    return null;
  }
}

export async function getAiRecommendationWithFallback(
  input: AiRecommendationInput,
  deterministicRecommendation: PricingRecommendation | null
): Promise<{
  aiRecommendation: AiRecommendationResult | null;
  fallbackReason: string | null;
}> {
  const aiResult = await getAiRecommendation(input);

  if (aiResult) {
    return { aiRecommendation: aiResult, fallbackReason: null };
  }

  if (deterministicRecommendation) {
    return {
      aiRecommendation: null,
      fallbackReason: "AI unavailable — showing rules-based recommendation",
    };
  }

  return {
    aiRecommendation: null,
    fallbackReason: "Insufficient data for any recommendation",
  };
}