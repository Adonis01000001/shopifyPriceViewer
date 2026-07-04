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
import { shopifyStores } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

// Helper: get or create a "Manual" store placeholder for products without Shopify
async function getOrCreateManualStore(userId: string): Promise<string> {
  const database = await db.getDb();
  if (!database) throw new Error("Database not available");

  // Look for existing manual store for this user
  const existing = await database.query.shopifyStores.findFirst({
    where: and(eq(shopifyStores.userId, userId), eq(shopifyStores.storeName, "Manual")),
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
      // Auto-create "Manual" store for products without Shopify connection
      const resolvedStoreId = input.storeId || (await getOrCreateManualStore(ctx.user!.id));

      const product = await productService.create({
        userId: ctx.user!.id,
        storeId: resolvedStoreId,
        title: input.title,
        description: input.description,
        sku: input.sku,
        barcode: input.barcode,
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
      const store = await productService.upsertStore({
        userId: ctx.user!.id,
        ...input,
        isActive: true,
      });
      if (!store)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save store",
        });
      return store;
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
