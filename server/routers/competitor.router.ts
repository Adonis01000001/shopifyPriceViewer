import { z } from "zod";
import { eq, and, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  competitorService,
  findOrCreateCompetitor,
} from "../services/competitor.service";
import { productService } from "../services/product.service";
import { scrapingService } from "../services/scraping.service";
import {
  competitorProducts,
  priceHistory,
  competitors,
  products,
  accountCompetitorConnections,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { entitlementService } from "../services/entitlement.service";


export const competitorRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return competitorService.getByUserId(ctx.user!.id, input);
    }),

  count: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    return competitorService.countByUserId(ctx.user!.id, input?.storeId);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const competitor = await competitorService.getById(
        ctx.user!.id,
        input.id,
        input.storeId
      );
      if (!competitor)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      return competitor;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        domain: z.string().min(1).max(255),
        logoUrl: z.string().url().optional(),
        description: z.string().optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await entitlementService.assertCanAdd(ctx.user!.id, "competitors");
      const competitor = await findOrCreateCompetitor(
        ctx.user!.id,
        input.domain,
        input.name,
        input.storeId
      );
      if (!competitor)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create competitor",
        });
      return competitor;
    }),

  bulkImport: protectedProcedure
    .input(
      z.object({
        competitors: z
          .array(
            z.object({
              name: z.string().min(1).max(255),
              domain: z.string().min(1).max(255),
        description: z.string().max(500).optional(),
              storeId: z.string().uuid().optional(),
            })
          )
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      await entitlementService.assertCanAdd(
        userId,
        "competitors",
        input.competitors.length
      );
      const result = await Promise.all(
        input.competitors.map(c =>
          findOrCreateCompetitor(userId, c.domain, c.name, c.storeId)
        )
      );
      return { imported: result.length };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        domain: z.string().min(1).max(255).optional(),
        logoUrl: z.string().url().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "inactive", "error"]).optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const competitor = await competitorService.update(ctx.user!.id, id, data, input.storeId);
      if (!competitor)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      return competitor;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      await competitorService.delete(ctx.user!.id, input.id, input.storeId);
      return { success: true };
    }),

  feed: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid(),
        limit: z.number().min(1).max(200).optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const feed = await competitorService.getFeed(
        ctx.user!.id,
        input.competitorId,
        input.limit ?? 50,
        input.storeId
      );
      if (!feed)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      return feed;
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return competitorService.search(ctx.user!.id, input.query, input.storeId);
    }),

  stats: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    return competitorService.getStats(ctx.user!.id, input?.storeId);
  }),

  products: protectedProcedure
    .input(z.object({ competitorId: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return competitorService.getProducts(ctx.user!.id, input.competitorId, input.storeId);
    }),

  addProduct: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid(),
        productId: z.string().uuid(),
        competitorProductUrl: z.string().url().optional(),
        competitorProductTitle: z.string().max(500).optional(),
        competitorSku: z.string().max(128).optional(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        currency: z.string().length(3).default("USD"),
        matchScore: z.number().min(0).max(1).default(0),
        matchMethod: z.string().max(64).default("manual"),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const product = await competitorService.addProduct(ctx.user!.id, {
        ...input,
        isVerified: false,
        isActive: true,
      });
      if (!product)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add competitor product",
        });
      return product;
    }),

  addManualProduct: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        competitorUrl: z.string().url(),
        price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .refine(value => Number(value) > 0, "Price must be greater than zero"),
        currency: z.string().length(3).default("USD"),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return competitorService.addManualProduct(ctx.user!.id, input);
    }),

  // ── Scrape competitor site for products ──────────────────────────────────
  updateProduct: protectedProcedure
    .input(
      z.object({
        competitorProductId: z.string().uuid(),
        competitorId: z.string().uuid().optional(),
        competitorProductUrl: z.string().url().optional(),
        competitorProductTitle: z.string().trim().min(1).max(500).optional(),
        competitorSku: z.string().trim().max(128).optional(),
        price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        currency: z.string().length(3).optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { competitorProductId, ...data } = input;
      const product = await competitorService.updateProduct(
        ctx.user!.id,
        competitorProductId,
        data
      );
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product link not found",
        });
      return product;
    }),

  scrapeProducts: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid(),
        searchQuery: z.string().max(200).optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const comp = await competitorService.getById(
        ctx.user!.id,
        input.competitorId,
        input.storeId
      );
      if (!comp)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      const result = await scrapingService.scrapeCompetitorSite(
        input.competitorId,
        comp.domain,
        input.searchQuery
      );
      return result;
    }),

  // ── Search user's existing products ──────────────────────────────────────
  searchProducts: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return productService.search(ctx.user!.id, input.query, input.storeId);
    }),

  // ── Remove a competitor product link ─────────────────────────────────────
  removeProduct: protectedProcedure
    .input(z.object({ competitorProductId: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await competitorService.removeProduct(
        ctx.user!.id,
        input.competitorProductId,
        input.storeId
      );
      if (!removed)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product link not found",
        });
      return { success: true };
    }),

  // ── Update competitor product price (manual) ─────────────────────────────
  updateProductPrice: protectedProcedure
    .input(
      z.object({
        competitorProductId: z.string().uuid(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await requireDb();
      const cp = await database
        .select({
          cp: competitorProducts,
          productId: competitorProducts.productId,
          currency: competitorProducts.currency,
        })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .innerJoin(products, eq(competitorProducts.productId, products.id))
        .where(
          and(
            eq(competitorProducts.id, input.competitorProductId),
            eq(products.userId, ctx.user!.id),
            input.storeId ? eq(products.storeId, input.storeId) : undefined,
            or(
              inArray(
                competitors.id,
                database
                  .select({ id: accountCompetitorConnections.competitorId })
                  .from(accountCompetitorConnections)
                  .where(
                    and(
                      eq(accountCompetitorConnections.userId, ctx.user!.id),
                      eq(accountCompetitorConnections.isActive, true)
                    )
                  )
              )
            )
          )
        )
        .limit(1);
      if (!cp[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });

      const oldPrice = cp[0].cp.price;
      await database
        .update(competitorProducts)
        .set({
          previousPrice: oldPrice,
          price: input.price,
          lastPriceUpdate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(competitorProducts.id, input.competitorProductId));

      await database.insert(priceHistory).values({
        productId: cp[0].productId,
        competitorProductId: input.competitorProductId,
        price: input.price,
        currency: cp[0].currency,
        source: "manual",
      });

      return { success: true, previousPrice: oldPrice, newPrice: input.price };
    }),

  // ── Analytics: all competitor products with prices ─────────────────────────
  getProductsForAnalytics: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const database = await requireDb();
    const rows = await database
      .select({
        competitorId: competitors.id,
        competitorName: competitors.name,
        competitorDomain: competitors.domain,
        price: competitorProducts.price,
        productTitle: competitorProducts.competitorProductTitle,
        productId: competitorProducts.productId,
        currency: competitorProducts.currency,
        updatedAt: competitorProducts.updatedAt,
      })
      .from(competitorProducts)
      .innerJoin(
        competitors,
        eq(competitorProducts.competitorId, competitors.id)
      )
      .innerJoin(products, eq(competitorProducts.productId, products.id))
      .where(
        and(
          eq(products.userId, ctx.user!.id),
          input?.storeId ? eq(products.storeId, input.storeId) : undefined,
          eq(competitorProducts.isActive, true),
          or(
            inArray(
              competitors.id,
              database
                .select({ id: accountCompetitorConnections.competitorId })
                .from(accountCompetitorConnections)
                .where(
                  and(
                    eq(accountCompetitorConnections.userId, ctx.user!.id),
                    eq(accountCompetitorConnections.isActive, true)
                  )
                )
            )
          )
        )
      )
      .orderBy(competitors.name);
    return rows;
  }),
});
