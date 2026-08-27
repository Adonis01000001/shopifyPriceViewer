import { AXIOS_TIMEOUT_MS, COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { productRouter } from "./routers/product.router";
import { competitorRouter } from "./routers/competitor.router";
import { priceRouter } from "./routers/price.router";
import { alertRouter } from "./routers/alert.router";
import { recommendationRouter } from "./routers/recommendation.router";
import { activityRouter } from "./routers/activity.router";
import { pipelineRouter } from "./routers/pipeline.router";
import { authRouter } from "./routers/auth.router";
import { intelligenceRouter } from "./routers/intelligence.router";
import { pricingEngineRouter } from "./routers/pricing-engine.router";
import { notificationRouter } from "./routers/notification.router";
import { accountRouter } from "./routers/account.router";
import { billingRouter } from "./routers/billing.router";
import { reportRouter } from "./routers/report.router";
import { analyticsRouter } from "./routers/analytics.router";
import { protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { publicShopifyStoreColumns } from "./_core/public-views";
import { z } from "zod";
import { shopifyStores } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import * as db from "./db";
import { encryptToken, decryptToken, isValidShopDomain } from "./_core/sdk";
import { ENV } from "./_core/env";
import { logger } from "./_core/logger";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  products: productRouter,
  competitors: competitorRouter,
  prices: priceRouter,
  alerts: alertRouter,
  recommendations: recommendationRouter,
  activity: activityRouter,
  pipeline: pipelineRouter,
  intelligence: intelligenceRouter,
  pricingEngine: pricingEngineRouter,
  notifications: notificationRouter,
  account: accountRouter,
  billing: billingRouter,
  reports: reportRouter,
  analytics: analyticsRouter,

  // ── Shopify store management (tRPC) ──────────────────────────────────────
  shopify: router({
    /**
     * List all Shopify stores connected to the current user.
     */
    listStores: protectedProcedure.query(async ({ ctx }) => {
      const database = await db.getDb();
      if (!database) return [];
      return database
        .select(publicShopifyStoreColumns)
        .from(shopifyStores)
        .where(
          and(
            eq(shopifyStores.userId, ctx.user!.id),
            eq(shopifyStores.isActive, true)
          )
        );
    }),

    /**
     * Connect a new Shopify store (or reconnect an existing one).
     * This exchanges the OAuth code for an access token.
     */
    connect: protectedProcedure
      .input(
        z.object({
          shop: z.string().min(1),
          code: z.string().min(1),
          state: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!isValidShopDomain(input.shop)) {
          throw new Error("Invalid Shopify store domain");
        }

        // Exchange code for access token
        const tokenUrl = `https://${input.shop}/admin/oauth/access_token`;
        const tokenRes = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: ENV.shopifyApiKey,
            client_secret: ENV.shopifyApiSecret,
            code: input.code,
          }),
          signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
        });

        if (!tokenRes.ok) {
          throw new Error(`Token exchange failed: ${tokenRes.status}`);
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData?.access_token;
        if (!accessToken) {
          throw new Error("No access token in response");
        }

        const encryptedToken = encryptToken(accessToken);
        const database = await db.getDb();
        if (!database) throw new Error("Database not available");

        const [existing] = await database
          .select({ id: shopifyStores.id, userId: shopifyStores.userId })
          .from(shopifyStores)
          .where(eq(shopifyStores.shopDomain, input.shop))
          .limit(1);

        if (existing) {
          if (existing.userId !== ctx.user!.id) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Store is already connected to another account",
            });
          }
          await database
            .update(shopifyStores)
            .set({
              accessToken: encryptedToken,
              scopes: ENV.shopifyScopes,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(shopifyStores.id, existing.id),
                eq(shopifyStores.userId, ctx.user!.id)
              )
            );
          return {
            success: true,
            storeId: existing.id,
            message: "Store reconnected",
          };
        }

        const result = await database
          .insert(shopifyStores)
          .values({
            userId: ctx.user!.id,
            shopDomain: input.shop,
            accessToken: encryptedToken,
            scopes: ENV.shopifyScopes,
            storeName: input.shop.split(".")[0].replace(/-/g, " "),
            currency: "USD",
            isActive: true,
          })
          .returning();

        return {
          success: true,
          storeId: result[0].id,
          message: "Store connected",
        };
      }),

    /**
     * Disconnect a Shopify store (soft delete — keeps history).
     */
    disconnect: protectedProcedure
      .input(z.object({ shopDomain: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const database = await db.getDb();
        if (!database) throw new Error("Database not available");

        await database
          .update(shopifyStores)
          .set({ isActive: false, accessToken: null, updatedAt: new Date() })
          .where(
            and(
              eq(shopifyStores.userId, ctx.user!.id),
              eq(shopifyStores.shopDomain, input.shopDomain)
            )
          );

        return { success: true };
      }),

    /**
     * Sync products from a connected Shopify store.
     * Fetches products from Shopify Admin API and bulk upserts them.
     */
    syncProducts: protectedProcedure
      .input(z.object({ storeId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const database = await db.getDb();
        if (!database) throw new Error("Database not available");

        // 1. Get the store and verify ownership
        const store = await database.query.shopifyStores.findFirst({
          where: and(
            eq(shopifyStores.id, input.storeId),
            eq(shopifyStores.userId, ctx.user!.id),
            eq(shopifyStores.isActive, true)
          ),
        });

        if (!store) {
          throw new Error("Store not found or not connected");
        }

        if (!store.accessToken) {
          throw new Error("Store has no access token. Please reconnect.");
        }

        // 2. Decrypt the access token
        const accessToken = decryptToken(store.accessToken);

        // 3. Fetch ALL products from Shopify Admin API (cursor-based pagination)
        const shopDomain = store.shopDomain;
        // Only products the shop is actually selling. Drafts and archived
        // items are not on sale, so monitoring competitors for them wastes
        // searches and puts things a merchant has retired on their dashboard.
        const baseUrl = `https://${shopDomain}/admin/api/2025-01/products.json?limit=250&status=active`;
        const allShopifyProducts: any[] = [];
        let nextUrl: string | null = baseUrl;
        const fetchOpts = {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        };

        while (nextUrl) {
          const resp: Response = await fetch(nextUrl, {
            ...fetchOpts,
            signal: AbortSignal.timeout(30000),
          });

          if (!resp.ok) {
            const errText: string = await resp.text().catch(() => "");
            logger.error(
              { status: resp.status, err: errText },
              "Shopify sync API error"
            );
            throw new Error(`Shopify API error: ${resp.status}`);
          }

          const data: any = await resp.json();
          const pageProducts: any[] = data.products || [];
          allShopifyProducts.push(...pageProducts);

          // Parse Link header for cursor-based pagination
          const linkHeader: string = resp.headers.get("link") || "";
          const nextMatch: RegExpMatchArray | null = linkHeader.match(
            /<([^>]+)>;\s*rel="next"/
          );
          nextUrl = nextMatch ? nextMatch[1] : null;
        }

        // 3b. Fetch unit cost per variant. Shopify keeps cost on InventoryItem,
        // not on the product payload, so it needs a second call. Without it
        // costPrice stays null and the pricing engine silently skips the
        // margin floor.
        const inventoryItemIds: string[] = allShopifyProducts
          .map((sp: any) => sp.variants?.[0]?.inventory_item_id)
          .filter(Boolean)
          .map((id: any) => String(id));
        const costByInventoryItemId = new Map<string, string>();

        for (let i = 0; i < inventoryItemIds.length; i += 100) {
          const batch = inventoryItemIds.slice(i, i + 100);
          const costResp: Response = await fetch(
            `https://${shopDomain}/admin/api/2025-01/inventory_items.json?ids=${batch.join(",")}&limit=100`,
            { ...fetchOpts, signal: AbortSignal.timeout(30000) }
          );
          if (!costResp.ok) {
            logger.warn(
              { status: costResp.status },
              "Shopify inventory cost fetch failed; margin protection will be unavailable for this sync"
            );
            break;
          }
          const costData: any = await costResp.json();
          for (const item of costData.inventory_items || []) {
            if (item?.cost != null && item.cost !== "") {
              costByInventoryItemId.set(String(item.id), String(item.cost));
            }
          }
        }

        logger.info(
          { withCost: costByInventoryItemId.size, total: inventoryItemIds.length },
          "Shopify sync: unit costs resolved"
        );

        if (allShopifyProducts.length === 0) {
          await database
            .update(shopifyStores)
            .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(eq(shopifyStores.id, input.storeId));
          return { synced: 0, message: "No products found in Shopify store" };
        }

        // 4. Map Shopify products to our schema (use first variant for price)
        const productItems = allShopifyProducts.map((sp: any) => {
          const variant = sp.variants?.[0];
          return {
            userId: ctx.user!.id,
            storeId: store.id,
            shopifyProductId: String(sp.id),
            shopifyVariantId: variant ? String(variant.id) : null,
            title: sp.title || "Untitled Product",
            description: sp.body_html?.replace(/<[^>]*>/g, "") || null,
            sku: variant?.sku || null,
            barcode: variant?.barcode || null,
            vendor: sp.vendor || null,
            productType: sp.product_type || null,
            category: sp.product_type || null,
            tags: sp.tags || null,
            price: variant?.price || "0.00",
            compareAtPrice: variant?.compare_at_price || null,
            costPrice: variant?.inventory_item_id
              ? (costByInventoryItemId.get(String(variant.inventory_item_id)) ?? null)
              : null,
            currency: store.currency || "USD",
            imageUrl: sp.images?.[0]?.src || null,
            status: "optimal" as const,
            isTracked: true,
            isActive: true,
          };
        });

        // 5. Bulk upsert via productService
        const { productService } = await import("./services/product.service");
        const count = await productService.bulkUpsertProducts(productItems);

        // 6. Update store's lastSyncedAt
        await database
          .update(shopifyStores)
          .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(shopifyStores.id, input.storeId));

        // 7. Import is the trigger. The whole chain -- discover competitors,
        // read their pages, validate with one AI call, price -- runs from here
        // without the merchant pressing anything. Fire and forget so the sync
        // response is not held open for the length of the pipeline.
        const pipelineUserId = ctx.user!.id;
        void import("./services/pipeline.service")
          .then(({ pipelineService }) => pipelineService.runForUser(pipelineUserId))
          .catch((err: unknown) =>
            logger.error({ err }, "Post-sync pipeline failed")
          );

        return {
          synced: count,
          message: `Synced ${count} products from Shopify. Finding competitor prices now.`,
        };
      }),

    // REMOVED: getToken endpoint (C-004). Shopify access tokens must NEVER be
    // sent to the frontend. All Shopify API calls should be proxied server-side.
  }),
});

export type AppRouter = typeof appRouter;
