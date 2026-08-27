import { z } from "zod";
import { AUTO_GENERATED_COMPETITOR_MATCH_METHOD } from "@shared/const";
import { protectedProcedure, router } from "../_core/trpc";
import { pricingEngine } from "../services/pricing-engine.service";
import { pricingRulesService } from "../services/pricing-rules.service";
import { recommendationService } from "../services/recommendation.service";
import { productService } from "../services/product.service";
import { getAiRecommendation } from "../services/ai-recommendation.service";
import {
  products,
  competitors,
  competitorProducts,
} from "../../drizzle/schema";
import { eq, and, isNull, ne, or } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";

export const pricingEngineRouter = router({
  /**
   * Analyze a single product's pricing position using the Strategic Undercutting Engine.
   * Returns market snapshot, recommendation, and position classification.
   */
  analyze: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await database
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.userId, ctx.user!.id)
          )
        )
        .limit(1);

      if (product.length === 0) return null;

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitors.userId, ctx.user!.id),
            eq(competitorProducts.isActive, true),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        );

      const prices = compPrices.map((c: { price: string }) => Number(c.price));
      const merchantPrice = Number(product[0].price);
      const costPrice =
        product[0].costPrice != null ? Number(product[0].costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
        rules: await pricingRulesService.forUser(ctx.user!.id),
      });

      return {
        productId: product[0].id,
        productTitle: product[0].title,
        ...analysis,
      };
    }),

  /**
   * AI-powered pricing recommendation using OpenRouter (or OpenAI fallback).
   * Returns an LLM-generated analysis with contextual reasoning.
   */
  aiRecommendation: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await database
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.userId, ctx.user!.id)
          )
        )
        .limit(1);

      if (product.length === 0) return null;

      const compRows = await database
        .select({
          price: competitorProducts.price,
          name: competitors.name,
        })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitors.userId, ctx.user!.id),
            eq(competitorProducts.isActive, true),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        );

      const prices = compRows.map(c => Number(c.price));
      const merchantPrice = Number(product[0].price);
      const costPrice =
        product[0].costPrice != null ? Number(product[0].costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
        rules: await pricingRulesService.forUser(ctx.user!.id),
      });

      const aiResult = await getAiRecommendation({
        productTitle: product[0].title,
        productCategory: product[0].category,
        merchantPrice,
        costPrice,
        competitorCount: prices.length,
        competitorPrices: compRows.map(c => ({
          name: c.name,
          price: Number(c.price),
        })),
        marketPosition: analysis.position.status,
        avgCompetitorPrice: analysis.marketSnapshot.avgCompetitorPrice,
      });

      if (!aiResult) {
        return {
          aiRecommendation: null,
          deterministicRecommendation: analysis.recommendation,
          fallbackReason:
            aiResult === null
              ? "AI unavailable — showing rules-based recommendation"
              : null,
        };
      }

      return {
        aiRecommendation: aiResult,
        deterministicRecommendation: analysis.recommendation,
        fallbackReason: null,
      };
    }),

  /**
   * Ensure a product has enough competitor data, auto-generating if needed,
   * then return the full pricing analysis including AI recommendation.
   */
  ensureAnalysis: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await database
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.userId, ctx.user!.id)
          )
        )
        .limit(1);

      if (product.length === 0) return null;

      const compRows = await database
        .select({
          price: competitorProducts.price,
          name: competitors.name,
        })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitors.userId, ctx.user!.id),
            eq(competitorProducts.isActive, true),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        );

      const prices = compRows.map(c => Number(c.price));
      const merchantPrice = Number(product[0].price);
      const costPrice =
        product[0].costPrice != null ? Number(product[0].costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
        rules: await pricingRulesService.forUser(ctx.user!.id),
      });

      // This used to ask a language model for a second opinion and show its
      // number beside the calculated one. Two different prices on one screen
      // is not advice, and it billed a model call on every page view.
      return {
        productId: product[0].id,
        productTitle: product[0].title,
        ...analysis,
        competitors: compRows.map(c => ({
          name: c.name,
          price: Number(c.price),
        })),
      };
    }),

  /**
   * Analyze all tracked products with competitor data.
   * Returns an array of product analyses.
   */
  analyzeAll: protectedProcedure.query(async ({ ctx }) => {
    const allProducts = await productService.getByUserId(ctx.user!.id, {
      limit: 1000,
    });
    const tracked = allProducts.filter(p => p.isTracked && p.isActive);

    const results: {
      productId: string;
      productTitle: string;
      marketSnapshot: {
        merchantPrice: number;
        avgCompetitorPrice: number | null;
        lowestCompetitorPrice: number | null;
        highestCompetitorPrice: number | null;
        competitorCount: number;
      };
      recommendation: {
        recommendedPrice: number;
        avgCompetitorPrice: number;
        minimumAllowedPrice: number;
        marginProtectionApplied: boolean;
        explanation: string;
      } | null;
      position: {
        status: "LEADING" | "COMPETITIVE" | "OVERPRICED" | "INSUFFICIENT_DATA";
        color: "green" | "blue" | "red" | "gray";
        label: string;
        meaning: string;
        priceDiff: number | null;
        priceDiffPercent: number | null;
      };
    }[] = [];

    const rules = await pricingRulesService.forUser(ctx.user!.id);
    for (const product of tracked) {
      const compPrices = await productService.getCompetitorPrices(
        ctx.user!.id,
        product.id
      );
      const prices = compPrices.map(c => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice =
        product.costPrice != null ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
        rules,
      });

      results.push({
        productId: product.id,
        productTitle: product.title,
        ...analysis,
      });
    }

    return results;
  }),

  /**
   * Lightweight endpoint returning just the market position classification for a product.
   */
  getMarketPosition: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await requireDb();

      const product = await database
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.userId, ctx.user!.id)
          )
        )
        .limit(1);

      if (product.length === 0) return null;

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(competitors.userId, ctx.user!.id),
            eq(competitorProducts.isActive, true),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        );

      const prices = compPrices.map((c: { price: string }) => Number(c.price));
      const merchantPrice = Number(product[0].price);

      const avgPrice = pricingEngine.calculateAverageCompetitorPrice(prices);
      const position = pricingEngine.classifyMarketPosition(
        merchantPrice,
        avgPrice
      );

      return {
        productId: product[0].id,
        productTitle: product[0].title,
        merchantPrice,
        avgCompetitorPrice: avgPrice,
        position,
      };
    }),

  /**
   * Generate a pricing recommendation for a product and persist it to the database.
   */
  generateRecommendation: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const recommendation = await recommendationService.generateForProduct(
        ctx.user!.id,
        input.productId
      );
      if (!recommendation) {
        return {
          success: false,
          message:
            "Unable to generate recommendation. Ensure the product exists and has competitor pricing data.",
        };
      }
      return { success: true, recommendation };
    }),

  /**
   * Dashboard aggregate stats: counts of products by market position.
   */
  dashboardStats: protectedProcedure.query(async ({ ctx }) => {
    const allProducts = await productService.getByUserId(ctx.user!.id, {
      limit: 1000,
    });
    const tracked = allProducts.filter(p => p.isTracked && p.isActive);

    const stats = {
      leading: 0,
      competitive: 0,
      overpriced: 0,
      insufficientData: 0,
      marginProtection: 0,
      total: tracked.length,
    };

    const rules = await pricingRulesService.forUser(ctx.user!.id);
    for (const product of tracked) {
      const compPrices = await productService.getCompetitorPrices(
        ctx.user!.id,
        product.id
      );
      const prices = compPrices.map(c => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice =
        product.costPrice != null ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
        rules,
      });

      switch (analysis.position.status) {
        case "LEADING":
          stats.leading++;
          break;
        case "COMPETITIVE":
          stats.competitive++;
          break;
        case "OVERPRICED":
          stats.overpriced++;
          break;
        case "INSUFFICIENT_DATA":
          stats.insufficientData++;
          break;
      }

      if (analysis.recommendation?.marginProtectionApplied) {
        stats.marginProtection++;
      }
    }

    return stats;
  }),
});
