import express, { type Express, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  accountShopConnections,
  products,
  shops,
} from "../../drizzle/schema";
import { requireDb } from "./db-assert";
import { isValidShopDomain, verifyWebhookHmac } from "./auth/hmac";
import { logger } from "./logger";

const COMPLIANCE_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

type ShopifyWebhookPayload = { shop_domain?: unknown };

function getHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return value?.trim() || undefined;
}

/** Registers the raw-body Shopify webhook endpoint before express.json(). */
export function registerShopifyWebhookRoute(app: Express) {
  app.post(
    "/api/shopify/webhooks",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req: Request, res: Response) => {
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "Invalid webhook body" });
        return;
      }

      const hmac = getHeader(req, "X-Shopify-Hmac-Sha256");
      if (!hmac || !verifyWebhookHmac(req.body, hmac)) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      const topic = getHeader(req, "X-Shopify-Topic") ?? "";
      let payload: ShopifyWebhookPayload;
      try {
        payload = JSON.parse(
          req.body.toString("utf8")
        ) as ShopifyWebhookPayload;
      } catch {
        res.status(400).json({ error: "Invalid webhook JSON" });
        return;
      }

      const shopDomain =
        getHeader(req, "X-Shopify-Shop-Domain") ??
        (typeof payload.shop_domain === "string"
          ? payload.shop_domain
          : undefined);
      if (!shopDomain || !isValidShopDomain(shopDomain)) {
        res.status(400).json({ error: "Invalid Shopify shop domain" });
        return;
      }

      try {
        const database = await requireDb();
        const connections = await database
          .select({ id: accountShopConnections.id })
          .from(accountShopConnections)
          .innerJoin(shops, eq(accountShopConnections.shopId, shops.id))
          .where(eq(shops.normalizedDomain, shopDomain.toLowerCase()))
        const connectionIds = connections.map(connection => connection.id);

        if (topic === "shop/redact" && connectionIds.length > 0) {
          await database.delete(products).where(inArray(products.storeId, connectionIds));
          await database
            .update(accountShopConnections)
            .set({ accessToken: null, isActive: false, connectionStatus: "inactive", updatedAt: new Date() })
            .where(inArray(accountShopConnections.id, connectionIds));
          logger.info({ shopDomain }, "Shopify shop data redacted");
        } else if (topic === "app/uninstalled" && connectionIds.length > 0) {
          await database
            .update(accountShopConnections)
            .set({ accessToken: null, isActive: false, connectionStatus: "inactive", updatedAt: new Date() })
            .where(inArray(accountShopConnections.id, connectionIds));
          logger.info({ shopDomain }, "Shopify app uninstall processed");
        } else if (COMPLIANCE_TOPICS.has(topic)) {
          // No customer/order scopes are requested and no Shopify customer
          // records are persisted. Acknowledge the request for Shopify.
          logger.info(
            { shopDomain, topic },
            "Shopify privacy webhook acknowledged"
          );
        } else {
          logger.info({ shopDomain, topic }, "Shopify webhook acknowledged");
        }

        res.status(200).json({ received: true });
      } catch (error) {
        logger.error(
          { err: error, shopDomain, topic },
          "Shopify webhook processing failed"
        );
        res.status(500).json({ error: "Webhook processing failed" });
      }
    }
  );
}
