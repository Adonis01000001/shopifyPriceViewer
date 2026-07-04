import crypto from "crypto";
import { ENV } from "../env";

/** Verify Shopify OAuth HMAC from query parameters. */
export function verifyShopifyHmac(
  queryParams: Record<string, string>
): boolean {
  const hmac = queryParams.hmac;
  if (!hmac) return false;

  const { hmac: _removed, ...rest } = queryParams;
  const sorted = Object.entries(rest).sort(([a], [b]) => a.localeCompare(b));
  const message = new URLSearchParams(sorted).toString();

  const digest = crypto
    .createHmac("sha256", ENV.shopifyApiSecret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

/** Verify Shopify webhook HMAC signature. */
export function verifyWebhookHmac(data: Buffer, hmacHeader: string): boolean {
  const digest = crypto
    .createHmac("sha256", ENV.shopifyApiSecret)
    .update(data)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

/** Validate that a string is a proper Shopify myshopify.com domain. */
export function isValidShopDomain(shop: string): boolean {
  return (
    typeof shop === "string" &&
    shop.endsWith(".myshopify.com") &&
    shop.length > ".myshopify.com".length
  );
}
