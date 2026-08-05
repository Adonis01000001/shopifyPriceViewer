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

  if (!/^[a-f0-9]{64}$/i.test(hmac) || digest.length !== hmac.length)
    return false;

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

/** Verify Shopify webhook HMAC signature. */
export function verifyWebhookHmac(data: Buffer, hmacHeader: string): boolean {
  const provided = hmacHeader?.trim();
  if (!provided) return false;
  const digest = crypto
    .createHmac("sha256", ENV.shopifyApiSecret)
    .update(data)
    .digest("base64");
  const expectedBuffer = Buffer.from(digest, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Validate that a string is a proper Shopify myshopify.com domain. */
export function isValidShopDomain(shop: string): boolean {
  return (
    typeof shop === "string" &&
    shop.endsWith(".myshopify.com") &&
    shop.length > ".myshopify.com".length
  );
}
