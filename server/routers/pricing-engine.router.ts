import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { pricingEngine } from "../services/pricing-engine.service";
import { recommendationService } from "../services/recommendation.service";
import { productService } from "../services/product.service";
import { products, competitorProducts } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
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
        .where(and(eq(products.id, input.productId), eq(products.userId, ctx.user!.id)))
        .limit(1);

      if (product.length === 0) return null;

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(and(
          eq(competitorProducts.productId, input.productId),
          eq(competitorProducts.isActive, true),
        ));

      const prices = compPrices.map((c) => Number(c.price));
      const merchantPrice = Number(product[0].price);
      const costPrice = product[0].costPrice != null ? Number(product[0].costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
      });

      return {
        productId: product[0].id,
        productTitle: product[0].title,
        ...analysis,
      };
    }),

  /**
   * Analyze all tracked products with competitor data.
   * Returns an array of product analyses.
   */
  analyzeAll: protectedProcedure.query(async ({ ctx }) => {
    const allProducts = await productService.getByUserId(ctx.user!.id, { limit: 1000 });
    const tracked = allProducts.filter((p) => p.isTracked && p.isActive);

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

    for (const product of tracked) {
      const compPrices = await productService.getCompetitorPrices(product.id);
      const prices = compPrices.map((c) => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice = product.costPrice != null ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
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
        .where(and(eq(products.id, input.productId), eq(products.userId, ctx.user!.id)))
        .limit(1);

      if (product.length === 0) return null;

      const compPrices = await database
        .select({ price: competitorProducts.price })
        .from(competitorProducts)
        .where(and(
          eq(competitorProducts.productId, input.productId),
          eq(competitorProducts.isActive, true),
        ));

      const prices = compPrices.map((c) => Number(c.price));
      const merchantPrice = Number(product[0].price);

      const avgPrice = pricingEngine.calculateAverageCompetitorPrice(prices);
      const position = pricingEngine.classifyMarketPosition(merchantPrice, avgPrice);

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
        input.productId,
      );
      if (!recommendation) {
        return { success: false, message: "Unable to generate recommendation. Ensure the product exists and has competitor pricing data." };
      }
      return { success: true, recommendation };
    }),

  /**
   * Dashboard aggregate stats: counts of products by market position.
   */
  dashboardStats: protectedProcedure.query(async ({ ctx }) => {
    const allProducts = await productService.getByUserId(ctx.user!.id, { limit: 1000 });
    const tracked = allProducts.filter((p) => p.isTracked && p.isActive);

    const stats = {
      leading: 0,
      competitive: 0,
      overpriced: 0,
      insufficientData: 0,
      marginProtection: 0,
      total: tracked.length,
    };

    for (const product of tracked) {
      const compPrices = await productService.getCompetitorPrices(product.id);
      const prices = compPrices.map((c) => Number(c.price));
      const merchantPrice = Number(product.price);
      const costPrice = product.costPrice != null ? Number(product.costPrice) : null;

      const analysis = pricingEngine.analyzeProduct({
        merchantPrice,
        costPrice,
        competitorPrices: prices,
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
