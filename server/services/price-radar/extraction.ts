import type {
  PriceRadarAvailability,
  PriceRadarExtractionResult,
  PriceRadarProduct,
} from "./types";
import {
  canonicalizeUrl,
  classifyUrl,
  extractInternalLinks,
} from "./url-policy";

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(html, [
    new RegExp(
      `<meta\\b[^>]*(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ]);
}

function parseJsonLd(html: string): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  const regex =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of Array.from(html.matchAll(regex))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") values.push(item);
      }
    } catch {
      // Invalid third-party JSON-LD is ignored and recorded as a warning later.
    }
  }
  return values;
}

function hasType(value: Record<string, unknown>, expected: string): boolean {
  const type = value["@type"];
  return Array.isArray(type)
    ? type.some(item => String(item).toLowerCase() === expected.toLowerCase())
    : String(type ?? "").toLowerCase() === expected.toLowerCase();
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const normalized = decodeHtml(String(value));
    return normalized || null;
  }
  if (value && typeof value === "object" && "name" in value) {
    return stringValue((value as { name?: unknown }).name);
  }
  return null;
}

function arrayStrings(value: unknown): string[] {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return input.map(stringValue).filter((item): item is string => !!item);
}

function decimal(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if (lastComma > lastDot) normalized = raw.replace(/\./g, "").replace(",", ".");
  else normalized = raw.replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

function integer(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function rating(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function availability(value: unknown): PriceRadarAvailability {
  const text = String(value ?? "").toLowerCase();
  if (/outofstock|out_of_stock|sold out|unavailable/.test(text)) return "out_of_stock";
  if (/preorder|pre-order|pre_order/.test(text)) return "preorder";
  if (/instock|in_stock|available|add to cart/.test(text)) return "in_stock";
  return "unknown";
}

function calculateDiscount(
  price: string | null,
  previousPrice: string | null,
  supplied?: unknown
): string | null {
  const explicit = decimal(supplied);
  if (explicit) return Math.min(100, Number(explicit)).toFixed(2);
  if (!price || !previousPrice || Number(previousPrice) <= Number(price)) return null;
  return (((Number(previousPrice) - Number(price)) / Number(previousPrice)) * 100).toFixed(2);
}

function getOffer(product: Record<string, unknown>): Record<string, unknown> {
  const offers = product.offers;
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) ?? {};
  return offers && typeof offers === "object"
    ? (offers as Record<string, unknown>)
    : {};
}

function normalizeAttributes(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const key = stringValue(entry.name);
      const val = stringValue(entry.value);
      if (key && val) result[key.slice(0, 128)] = val.slice(0, 1000);
    }
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      const normalized = stringValue(val);
      if (normalized) result[key.slice(0, 128)] = normalized.slice(0, 1000);
    }
  }
  return result;
}

export function extractProductData(
  html: string,
  pageUrl: string
): PriceRadarExtractionResult {
  const warnings: string[] = [];
  const methods: string[] = [];
  const jsonLdValues = parseJsonLd(html);
  const jsonLdProduct = jsonLdValues.find(item => hasType(item, "Product")) ?? null;
  const offer = jsonLdProduct ? getOffer(jsonLdProduct) : {};
  const aggregate =
    jsonLdProduct?.aggregateRating &&
    typeof jsonLdProduct.aggregateRating === "object"
      ? (jsonLdProduct.aggregateRating as Record<string, unknown>)
      : {};

  if (jsonLdProduct) methods.push("json-ld");
  const ogTitle = meta(html, "og:title");
  const htmlTitle = firstMatch(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]);
  const name = stringValue(jsonLdProduct?.name) ?? ogTitle ?? htmlTitle;
  if (ogTitle || htmlTitle) methods.push("html-metadata");

  const price =
    decimal(offer.price) ??
    decimal(jsonLdProduct?.price) ??
    decimal(meta(html, "product:price:amount")) ??
    decimal(meta(html, "og:price:amount")) ??
    decimal(
      firstMatch(html, [
        /\b(?:sale[-_\s]?price|current[-_\s]?price|price)\b[^>]{0,120}content=["']([^"']+)["']/i,
        /(?:[$€£¥]\s?[\d.,]+|[\d.,]+\s?(?:USD|EUR|GBP|CAD|AUD))/i,
      ])
    );
  const previousPrice =
    decimal(offer.highPrice) ??
    decimal(meta(html, "product:original_price:amount")) ??
    decimal(
      firstMatch(html, [
        /<(?:del|s)\b[^>]*>([\s\S]*?)<\/(?:del|s)>/i,
        /\b(?:was|list[-_\s]?price|original[-_\s]?price)\b[^>]{0,100}>\s*([^<]+)/i,
      ])
    );
  if (price) methods.push("price-fallback");

  const currency = (
    stringValue(offer.priceCurrency) ??
    meta(html, "product:price:currency") ??
    meta(html, "og:price:currency") ??
    (html.includes("€") ? "EUR" : html.includes("£") ? "GBP" : html.includes("$") ? "USD" : null)
  )?.toUpperCase() ?? null;
  const images = [
    ...arrayStrings(jsonLdProduct?.image),
    ...arrayStrings(meta(html, "og:image")),
  ]
    .map(url => canonicalizeUrl(url, pageUrl))
    .filter((url): url is string => !!url);
  const canonicalUrl =
    canonicalizeUrl(stringValue(jsonLdProduct?.url) ?? meta(html, "og:url") ?? pageUrl, pageUrl) ??
    pageUrl;
  const brand = stringValue(jsonLdProduct?.brand);
  const sku = stringValue(jsonLdProduct?.sku) ?? meta(html, "product:retailer_item_id");
  const gtin =
    stringValue(jsonLdProduct?.gtin14) ??
    stringValue(jsonLdProduct?.gtin13) ??
    stringValue(jsonLdProduct?.gtin12) ??
    stringValue(jsonLdProduct?.gtin8) ??
    stringValue(jsonLdProduct?.gtin);
  const barcode = stringValue(jsonLdProduct?.mpn) ?? gtin;
  const category =
    stringValue(jsonLdProduct?.category) ??
    meta(html, "product:category") ??
    firstMatch(html, [/<nav\b[^>]*(?:breadcrumb|breadcrumbs)[^>]*>([\s\S]*?)<\/nav>/i]);
  const seller = stringValue(offer.seller);
  const attributes = normalizeAttributes(
    jsonLdProduct?.additionalProperty ?? jsonLdProduct?.additionalProperties
  );
  const pageKind = jsonLdProduct || (name && price) ? "product" : classifyUrl(pageUrl);
  const confidence =
    Math.min(
      1,
      (jsonLdProduct ? 0.45 : 0) +
        (name ? 0.2 : 0) +
        (price ? 0.2 : 0) +
        (sku || gtin ? 0.1 : 0) +
        (images.length ? 0.05 : 0)
    );

  if (!name) warnings.push("No product name found");
  if (!price) warnings.push("No product price found");
  const product: PriceRadarProduct | null =
    pageKind === "product" && name
      ? {
          name: name.slice(0, 500),
          brand: brand?.slice(0, 255) ?? null,
          price,
          currency,
          previousPrice,
          discountPercent: calculateDiscount(price, previousPrice),
          productUrl: canonicalUrl,
          images: Array.from(new Set(images)).slice(0, 20),
          availability: availability(offer.availability ?? jsonLdProduct?.availability ?? html),
          sku: sku?.slice(0, 128) ?? null,
          barcode: barcode?.slice(0, 128) ?? null,
          gtin: gtin?.slice(0, 128) ?? null,
          category: category?.slice(0, 255) ?? null,
          attributes,
          rating: rating(aggregate.ratingValue),
          reviewCount: integer(aggregate.reviewCount ?? aggregate.ratingCount),
          seller: seller?.slice(0, 255) ?? null,
          structuredMetadata: Object.fromEntries(
            [
              ["openGraphTitle", ogTitle],
              ["description", meta(html, "description") ?? meta(html, "og:description")],
              ["canonical", canonicalUrl],
            ].filter(([, value]) => value != null)
          ),
          jsonLd: jsonLdProduct,
          extractionMethod: methods.join("+") || "html",
          extractionConfidence: confidence,
        }
      : null;

  return {
    product,
    pageKind,
    discoveredUrls: extractInternalLinks(html, pageUrl),
    warnings,
    methods,
  };
}

export function shouldRenderWithBrowser(
  html: string,
  result: PriceRadarExtractionResult
): boolean {
  if (result.product?.price) return false;
  return (
    html.length < 1500 ||
    /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html) ||
    /enable javascript|javascript is required|please turn on javascript/i.test(html)
  );
}
