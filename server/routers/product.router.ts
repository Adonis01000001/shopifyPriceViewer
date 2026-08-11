import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { productService } from "../services/product.service";
import {
  skuSchema,
  productNameSchema,
  priceSchema,
} from "../../shared/validation";
import * as db from "../db";
import {
  products,
  shopifyStores,
  competitors,
  competitorProducts,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { encryptToken } from "../_core/sdk";
import { toPublicShopifyStore } from "../_core/public-views";
import { entitlementService } from "../services/entitlement.service";

// Helper: get or create a "Manual" store placeholder for products without Shopify
async function getOrCreateManualStore(userId: string): Promise<string> {
  const database = await db.getDb();
  if (!database) throw new Error("Database not available");

  // Look for existing manual store for this user
  const existing = await database.query.shopifyStores.findFirst({
    where: and(
      eq(shopifyStores.userId, userId),
      eq(shopifyStores.storeName, "Manual")
    ),
  });

  if (existing) return existing.id;

  // Create a placeholder manual store
  const result = await database
    .insert(shopifyStores)
    .values({
      userId,
      shopDomain: `manual-${userId.slice(0, 8)}`,
      storeName: "Manual",
      currency: "USD",
      isActive: true,
      scopes: "manual",
    })
    .returning();

  return result[0].id;
}

export const productRouter = router({
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
      return productService.getByUserId(ctx.user!.id, input);
    }),

  count: protectedProcedure.query(async ({ ctx }) => {
    return productService.countByUserId(ctx.user!.id);
  }),

  listByStore: protectedProcedure
    .input(z.object({ storeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return productService.getByStoreId(ctx.user!.id, input.storeId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const product = await productService.getById(ctx.user!.id, input.id);
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return product;
    }),

  create: protectedProcedure
    .input(
      z.object({
        storeId: z.string().uuid().optional(),
        title: productNameSchema,
        description: z.string().optional(),
        sku: skuSchema,
        barcode: z.string().max(128).optional(),
        gtin: z.string().max(128).optional(),
        mpn: z.string().max(128).optional(),
        modelNumber: z.string().max(128).optional(),
        vendor: z.string().max(255).optional(),
        productType: z.string().max(255).optional(),
        category: z.string().max(255).optional(),
        tags: z.string().optional(),
        price: priceSchema,
        compareAtPrice: priceSchema.optional(),
        costPrice: priceSchema.optional(),
        currency: z.string().length(3).default("USD"),
        imageUrl: z.string().url().optional(),
        shopifyProductId: z.string().max(64).optional(),
        shopifyVariantId: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await entitlementService.assertCanAdd(ctx.user!.id, "products");
      // Auto-create "Manual" store for products without Shopify connection
      const resolvedStoreId =
        input.storeId || (await getOrCreateManualStore(ctx.user!.id));

      const product = await productService.create({
        userId: ctx.user!.id,
        storeId: resolvedStoreId,
        title: input.title,
        description: input.description,
        sku: input.sku,
        barcode: input.barcode,
        gtin: input.gtin,
        mpn: input.mpn,
        modelNumber: input.modelNumber,
        vendor: input.vendor,
        productType: input.productType,
        category: input.category,
        tags: input.tags,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        costPrice: input.costPrice,
        currency: input.currency,
        imageUrl: input.imageUrl,
        shopifyProductId: input.shopifyProductId,
        shopifyVariantId: input.shopifyVariantId,
        status: "optimal",
        isTracked: true,
        isActive: true,
      });
      if (!product)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create product",
        });
      return product;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: productNameSchema.optional(),
        description: z.string().optional(),
        sku: skuSchema,
        barcode: z.string().max(128).optional(),
        gtin: z.string().max(128).optional(),
        mpn: z.string().max(128).optional(),
        modelNumber: z.string().max(128).optional(),
        category: z.string().max(255).optional(),
        price: priceSchema.optional(),
        compareAtPrice: priceSchema.optional(),
        costPrice: priceSchema.optional(),
        imageUrl: z.string().url().optional(),
        status: z
          .enum(["optimal", "underpriced", "overpriced", "alert"])
          .optional(),
        isTracked: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const product = await productService.update(ctx.user!.id, id, data);
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return product;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await productService.delete(ctx.user!.id, input.id);
      return { success: true };
    }),

  toggleTracking: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isTracked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const product = await productService.toggleTracking(
        ctx.user!.id,
        input.id,
        input.isTracked
      );
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return product;
    }),

  getCompetitorPrices: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await db.getDb();
      if (!database) throw new Error("Database not available");

      const rows = await database
        .select({
          id: competitorProducts.id,
          competitorId: competitorProducts.competitorId,
          competitorName: competitors.name,
          competitorDomain: competitors.domain,
          title: competitorProducts.competitorProductTitle,
          sku: competitorProducts.competitorSku,
          price: competitorProducts.price,
          currency: competitorProducts.currency,
          url: competitorProducts.competitorProductUrl,
          matchScore: competitorProducts.matchScore,
          lastScrapedAt: competitorProducts.lastScrapedAt,
        })
        .from(competitorProducts)
        .innerJoin(products, eq(competitorProducts.productId, products.id))
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(competitorProducts.productId, input.productId),
            eq(products.userId, ctx.user!.id),
            eq(competitors.userId, ctx.user!.id),
            eq(competitorProducts.isActive, true)
          )
        );

      return rows;
    }),

  getCompetitorMappings: protectedProcedure.query(({ ctx }) =>
    productService.getCompetitorPricesForUser(ctx.user!.id)
  ),

  dismissCompetitorMapping: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        competitorId: z.string().uuid(),
        sourceType: z.enum(["price-radar", "scoop", "automatic-discovery"]),
        sourceProductId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await productService.dismissCompetitorMapping(ctx.user!.id, input);
      return { success: true };
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return productService.getStats(ctx.user!.id);
  }),

  stores: protectedProcedure.query(async ({ ctx }) => {
    return productService.getStores(ctx.user!.id);
  }),

  upsertStore: protectedProcedure
    .input(
      z.object({
        shopDomain: z.string().min(1).max(255),
        accessToken: z.string().min(1),
        scopes: z.string().min(1),
        storeName: z.string().max(255).optional(),
        storeEmail: z.string().max(320).optional(),
        currency: z.string().length(3).default("USD"),
        timezone: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accessToken, ...storeInput } = input;
      const store = await productService.upsertStore({
        userId: ctx.user!.id,
        ...storeInput,
        accessToken: encryptToken(accessToken),
        isActive: true,
      });
      if (!store)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save store",
        });
      return toPublicShopifyStore(store);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      return productService.search(ctx.user!.id, input.query);
    }),

  bulkSync: protectedProcedure
    .input(
      z.array(
        z.object({
          storeId: z.string().uuid(),
        title: productNameSchema,
        description: z.string().optional(),
        sku: skuSchema,
        vendor: z.string().max(255).optional(),
        barcode: z.string().max(128).optional(),
        gtin: z.string().max(128).optional(),
        mpn: z.string().max(128).optional(),
        modelNumber: z.string().max(128).optional(),
          productType: z.string().max(255).optional(),
          category: z.string().max(255).optional(),
          price: priceSchema,
          compareAtPrice: priceSchema.optional(),
          currency: z.string().length(3).default("USD"),
          imageUrl: z.string().url().optional(),
          shopifyProductId: z.string().max(64).optional(),
        })
      )
    )
    .mutation(async ({ ctx, input }) => {
      const items = input.map(item => ({
        ...item,
        userId: ctx.user!.id,
        status: "optimal" as const,
        isTracked: true,
        isActive: true,
      }));
      const count = await productService.bulkUpsertProducts(items);
      return { synced: count };
    }),
});
