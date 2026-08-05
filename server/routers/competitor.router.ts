import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { competitorService } from "../services/competitor.service";
import { productService } from "../services/product.service";
import { scrapingService } from "../services/scraping.service";
import { persistScoopCatalogImport } from "../services/scoop.service";
import {
  competitorProducts,
  products,
  priceHistory,
  competitors,
  activityLogs,
  priceRadarProducts,
  scoopCompetitorProducts,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { entitlementService } from "../services/entitlement.service";

const competitorFeedProductIdSchema = z.string().refine(
  value => {
    if (z.string().uuid().safeParse(value).success) return true;

    const separator = value.indexOf(":");
    if (separator <= 0 || separator === value.length - 1) return false;
    if (value.indexOf(":", separator + 1) !== -1) return false;

    const source = value.slice(0, separator);
    const productId = value.slice(separator + 1);
    return (
      (source === "price-radar" || source === "scoop") &&
      z.string().uuid().safeParse(productId).success
    );
  },
  { message: "Invalid competitor product ID" }
);

export const competitorRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return competitorService.getByUserId(ctx.user!.id, input);
    }),

  count: protectedProcedure.query(async ({ ctx }) => {
    return competitorService.countByUserId(ctx.user!.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const competitor = await competitorService.getById(
        ctx.user!.id,
        input.id
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await entitlementService.assertCanAdd(ctx.user!.id, "competitors");
      const competitor = await competitorService.create({
        userId: ctx.user!.id,
        ...input,
        status: "active",
        productsTracked: 0,
        avgPriceDiff: "0.00",
        priceIndex: "100.00",
        scrapeStatus: "pending",
      });
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
      const rows = input.competitors.map(c => ({
        userId,
        name: c.name,
        domain: c.domain,
        description: c.description ?? null,
        logoUrl: null,
        status: "active" as const,
        productsTracked: 0,
        avgPriceDiff: "0.00" as const,
        priceIndex: "100.00" as const,
        scrapeStatus: "pending" as const,
        lastScrapedAt: null,
        scrapeError: null,
      }));
      const result = await competitorService.bulkCreate(rows);
      return { imported: result.length };
    }),

  importCatalog: protectedProcedure
    .input(
      z.object({
        sourceName: z.string().trim().min(1).max(255),
        products: z
          .array(
            z.object({
              productName: z.string().trim().min(1).max(500),
              brand: z.string().trim().max(255).nullable(),
              model: z.string().trim().max(255).nullable(),
              price: z.string().trim().max(64).nullable(),
              currency: z.string().trim().max(10).nullable(),
              rating: z.number().min(0).max(5).nullable(),
              reviewCount: z.number().int().min(0).nullable(),
              availability: z.string().trim().max(64).nullable(),
              seller: z.string().trim().max(255).nullable(),
              condition: z.enum(["new", "refurbished", "used"]).nullable(),
              shipping: z.string().trim().max(500).nullable(),
              productUrl: z.string().url().max(2_000),
              imageUrl: z.string().url().max(2_000).nullable(),
              retrievedAt: z.string().datetime(),
              publishedDate: z.string().max(64).nullable(),
              confidenceScore: z.number().min(0).max(1),
              extractionMethod: z.string().trim().min(1).max(64),
              discoveredBy: z.array(z.string().max(128)).max(20),
            })
          )
          .min(1)
          .max(2_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return persistScoopCatalogImport(ctx.user!.id, input);
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const competitor = await competitorService.update(ctx.user!.id, id, data);
      if (!competitor)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      return competitor;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await competitorService.delete(ctx.user!.id, input.id);
      return { success: true };
    }),

  moveScoopProduct: protectedProcedure
    .input(
      z.object({
        scoopProductId: z.string().uuid(),
        targetCompetitorId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const moved = await competitorService.moveScoopProduct(
        ctx.user!.id,
        input.scoopProductId,
        input.targetCompetitorId
      );
      if (!moved)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scoop product or target competitor not found",
        });
      return moved;
    }),

  feed: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid(),
        limit: z.number().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const feed = await competitorService.getFeed(
        ctx.user!.id,
        input.competitorId,
        input.limit ?? 50
      );
      if (!feed)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor not found",
        });
      return feed;
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      return competitorService.search(ctx.user!.id, input.query);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return competitorService.getStats(ctx.user!.id);
  }),

  products: protectedProcedure
    .input(z.object({ competitorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return competitorService.getProducts(ctx.user!.id, input.competitorId);
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

  // ── Scrape competitor site for products ──────────────────────────────────
  scrapeProducts: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid(),
        searchQuery: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const comp = await competitorService.getById(
        ctx.user!.id,
        input.competitorId
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
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      return productService.search(ctx.user!.id, input.query);
    }),

  // ── Remove a competitor product link ─────────────────────────────────────
  removeProduct: protectedProcedure
    .input(z.object({ competitorProductId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await competitorService.removeProduct(
        ctx.user!.id,
        input.competitorProductId
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
        competitorProductId: competitorFeedProductIdSchema,
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await requireDb();
      const [source, rawProductId] = input.competitorProductId.split(":", 2);

      // Price Radar and Scoop products are virtual feed rows. They are not
      // stored in competitor_products, so update their owning source table
      // after validating the authenticated user's ownership.
      if (source === "price-radar" || source === "scoop") {
        const parsedId = z.string().uuid().safeParse(rawProductId);
        if (!parsedId.success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Product not found",
          });
        }

        const now = new Date();
        if (source === "price-radar") {
          const [radarProduct] = await database
            .select({
              id: priceRadarProducts.id,
              price: priceRadarProducts.price,
            })
            .from(priceRadarProducts)
            .where(
              and(
                eq(priceRadarProducts.id, parsedId.data),
                eq(priceRadarProducts.userId, ctx.user!.id)
              )
            )
            .limit(1);
          if (!radarProduct) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Product not found",
            });
          }

          await database
            .update(priceRadarProducts)
            .set({
              previousPrice: radarProduct.price,
              price: input.price,
              lastSeenAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(priceRadarProducts.id, parsedId.data),
                eq(priceRadarProducts.userId, ctx.user!.id)
              )
            );

          return {
            success: true,
            previousPrice: radarProduct.price,
            newPrice: input.price,
          };
        }

        const [scoopProduct] = await database
          .select({
            id: scoopCompetitorProducts.id,
            price: scoopCompetitorProducts.price,
          })
          .from(scoopCompetitorProducts)
          .where(
            and(
              eq(scoopCompetitorProducts.id, parsedId.data),
              eq(scoopCompetitorProducts.userId, ctx.user!.id)
            )
          )
          .limit(1);
        if (!scoopProduct) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Product not found",
          });
        }

        await database
          .update(scoopCompetitorProducts)
          .set({ price: input.price, lastSeenAt: now })
          .where(
            and(
              eq(scoopCompetitorProducts.id, parsedId.data),
              eq(scoopCompetitorProducts.userId, ctx.user!.id)
            )
          );

        return {
          success: true,
          previousPrice: scoopProduct.price,
          newPrice: input.price,
        };
      }

      const cp = await database
        .select({
          cp: competitorProducts,
          compUserId: competitors.userId,
          productId: competitorProducts.productId,
          currency: competitorProducts.currency,
        })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(eq(competitorProducts.id, input.competitorProductId))
        .limit(1);
      if (!cp[0] || cp[0].compUserId !== ctx.user!.id)
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
  getProductsForAnalytics: protectedProcedure.query(async ({ ctx }) => {
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
      .where(
        and(
          eq(competitors.userId, ctx.user!.id),
          eq(competitorProducts.isActive, true)
        )
      )
      .orderBy(competitors.name);
    return rows;
  }),
});
