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
  accountShopConnections,
  shops,
  competitors,
  competitorProducts,
  accountCompetitorConnections,
} from "../../drizzle/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { encryptToken } from "../_core/sdk";
import { logger } from "../_core/logger";
import { toPublicShopifyStore } from "../_core/public-views";
import { entitlementService } from "../services/entitlement.service";
import { getOrCreateAccountShopConnection, getOrCreateShop } from "../services/shop.service";

// Helper: get or create a "Manual" store placeholder for products without Shopify
async function getOrCreateManualStore(userId: string): Promise<string> {
  const database = await db.getDb();
  if (!database) throw new Error("Database not available");

  const shop = await getOrCreateShop(`manual-${userId.slice(0, 8)}.local`, {
    name: "Manual",
    platform: "manual",
    database,
  });
  const connection = await getOrCreateAccountShopConnection(userId, shop.id, {
    storeName: "Manual",
    currency: "USD",
    scopes: "manual",
    database,
  });
  return connection.id;
}

/**
 * Minimal RFC4180-ish CSV parser: handles quoted fields with embedded commas,
 * newlines and doubled quotes. Enough for merchant catalogue exports and it
 * avoids adding a dependency.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/** Accept the header names merchants actually export. */
const COLUMN_ALIASES: Record<string, string[]> = {
  title: ["title", "name", "product", "product name", "product_title"],
  sku: ["sku", "variant sku", "code", "reference"],
  price: ["price", "selling price", "retail price", "variant price"],
  cost: ["cost", "cost price", "cost per item", "buy price", "wholesale"],
  category: ["category", "type", "product type", "product_type"],
  vendor: ["vendor", "brand", "manufacturer", "supplier"],
};

function mapHeaders(header: string[]): Record<string, number> {
  const found: Record<string, number> = {};
  header.forEach((raw, idx) => {
    const key = raw.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (found[field] === undefined && aliases.includes(key)) found[field] = idx;
    }
  });
  return found;
}

export const productRouter = router({
  /**
   * Import a catalogue from CSV. This is what makes the product usable by a
   * merchant who is not on Shopify: same destination table, same downstream
   * pipeline, no platform assumptions.
   */
  importCsv: protectedProcedure
    .input(
      z.object({
        csv: z.string().min(1).max(5_000_000),
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rows = parseCsv(input.csv);
      if (rows.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The file needs a header row and at least one product.",
        });
      }

      const cols = mapHeaders(rows[0]);
      if (cols.title === undefined || cols.price === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Could not find a title and a price column. Expected headers such as: title, price, sku, cost, category, vendor.",
        });
      }

      const database = await db.getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      }

      const storeId = input.storeId ?? (await getOrCreateManualStore(ctx.user!.id));
      const errors: Array<{ row: number; reason: string }> = [];
      const toInsert: Array<Record<string, unknown>> = [];

      for (let i = 1; i < rows.length; i++) {
        const cell = (idx?: number) =>
          idx === undefined ? undefined : (rows[i][idx] ?? "").trim();

        const title = cell(cols.title);
        const priceRaw = (cell(cols.price) ?? "").replace(/[^0-9.,-]/g, "").replace(",", ".");
        const price = Number(priceRaw);

        if (!title) { errors.push({ row: i + 1, reason: "missing title" }); continue; }
        if (!Number.isFinite(price) || price <= 0) {
          errors.push({ row: i + 1, reason: `invalid price "${cell(cols.price) ?? ""}"` });
          continue;
        }

        const costRaw = (cell(cols.cost) ?? "").replace(/[^0-9.,-]/g, "").replace(",", ".");
        const cost = Number(costRaw);

        toInsert.push({
          userId: ctx.user!.id,
          storeId,
          title,
          sku: cell(cols.sku) || null,
          vendor: cell(cols.vendor) || null,
          category: cell(cols.category) || null,
          productType: cell(cols.category) || null,
          price: price.toFixed(2),
          costPrice: Number.isFinite(cost) && cost > 0 ? cost.toFixed(2) : null,
          currency: "USD",
          status: "optimal" as const,
          isTracked: true,
          isActive: true,
        });
      }

      if (toInsert.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No usable rows. First problem: ${errors[0]?.reason ?? "unknown"}`,
        });
      }

      await entitlementService.assertCanAdd(ctx.user!.id, "products");
      const imported = await productService.bulkUpsertProducts(toInsert as never);

      // A successful import is an explicit trigger. Use the resolved store ID
      // so an import without an explicit store cannot accidentally run the
      // pipeline across every store owned by the account.
      const uid = ctx.user!.id;
      void import("../services/pipeline.service")
        .then(({ pipelineService }) =>
          pipelineService.runForUser(uid, 50, undefined, storeId)
        )
        .catch(err =>
          logger.error(
            {
              userId: uid,
              storeId,
              error: err instanceof Error ? err.message : String(err),
            },
            "CSV-triggered pipeline failed"
          )
        );

      return {
        imported,
        skipped: errors.length,
        errors: errors.slice(0, 20),
        message: `Imported ${imported} products${errors.length ? `, skipped ${errors.length}` : ""}. Finding competitor prices now.`,
      };
    }),

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
      return productService.getByUserId(ctx.user!.id, input);
    }),

  count: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    return productService.countByUserId(ctx.user!.id, input?.storeId);
  }),

  listByStore: protectedProcedure
    .input(z.object({ storeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return productService.getByStoreId(ctx.user!.id, input.storeId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const product = await productService.getById(ctx.user!.id, input.id, input.storeId);
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
        storeId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const product = await productService.update(ctx.user!.id, id, data, input.storeId);
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return product;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      await productService.delete(ctx.user!.id, input.id, input.storeId);
      return { success: true };
    }),

  toggleTracking: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isTracked: z.boolean(), storeId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const product = await productService.toggleTracking(
        ctx.user!.id,
        input.id,
        input.isTracked,
        input.storeId
      );
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return product;
    }),

  getCompetitorPrices: protectedProcedure
    .input(z.object({ productId: z.string().uuid(), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const database = await db.getDb();
      if (!database) throw new Error("Database not available");
      const ownedProduct = await productService.getById(
        ctx.user!.id,
        input.productId,
        input.storeId
      );
      if (!ownedProduct) return [];

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
          matchMethod: competitorProducts.matchMethod,
          isVerified: competitorProducts.isVerified,
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
            ),
            eq(competitorProducts.isActive, true)
          )
        );

      return rows;
    }),

  getCompetitorMappings: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
    productService.getCompetitorPricesForUser(ctx.user!.id, input?.storeId)
  ),

  stats: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    return productService.getStats(ctx.user!.id, input?.storeId);
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
      });
      if (!store)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save store",
        });
      return toPublicShopifyStore(store);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200), storeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return productService.search(ctx.user!.id, input.query, input.storeId);
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
