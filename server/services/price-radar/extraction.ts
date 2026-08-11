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
import { extractOfferQuantity } from "../competitor-discovery.normalization";

const AMAZON_DOT_COM_PRICE_XPATH =
  "/html/body/div[1]/div[1]/div/div[5]/div[1]/div[7]/div/div[1]/div/div/div/form/div/div/div/div/div[3]/div/div[1]/div/div/div/span[1]/span[1]";
const EBAY_DOT_COM_PRODUCT_FIELD_XPATH =
  "/html/body/div[2]/main/div[1]/div[1]/div[4]/div[2]/div/div/div[3]/div/div/div/span";
const WALMART_DOT_COM_PRICE_XPATH =
  "/html/body/div/div/div/div[1]/div/div[1]/main/section/div[2]/div[2]/div/div[3]/div/div[1]/div/div[2]/div/div/div[1]/section/div/span[2]/span[2]/span";

interface HtmlTreeNode {
  tagName: string;
  children: HtmlTreeNode[];
  text: string[];
}

const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

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

function isSiteDomain(pageUrl: string, domain: string): boolean {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isAmazonDotCom(pageUrl: string): boolean {
  return isSiteDomain(pageUrl, "amazon.com");
}

function isEbayDotCom(pageUrl: string): boolean {
  return isSiteDomain(pageUrl, "ebay.com");
}

function isWalmartDotCom(pageUrl: string): boolean {
  return isSiteDomain(pageUrl, "walmart.com");
}

function amazonNameFromDescription(description: string | null): string | null {
  if (!description) return null;
  let candidate = description
    .replace(/^Amazon\.com\s*[:-]\s*/i, "")
    .replace(/^Buy\s+/i, "")
    .replace(/^Shop for the\s+/i, "")
    .trim();

  const suffixIndex = candidate.search(
    /\s+(?:at|on)\s+(?:the\s+)?Amazon\b|\s*[-:]\s*Amazon\.com\b/i
  );
  if (suffixIndex > 0) candidate = candidate.slice(0, suffixIndex);
  candidate = candidate.split(/\s+:\s+/)[0]?.trim() ?? "";
  candidate = candidate.replace(/[.:,\s]+$/, "").trim();

  if (
    !candidate ||
    /^Amazon(?:\.com)?$/i.test(candidate) ||
    /^(?:Online shopping|Shop Amazon)\b/i.test(candidate)
  ) {
    return null;
  }
  return decodeHtml(candidate);
}

export function resolveProductDisplayName(
  name: string | null,
  pageUrl: string,
  description: string | null
): string | null {
  const normalized = name?.trim() || null;
  if (
    !isAmazonDotCom(pageUrl) ||
    (normalized && !/^Amazon(?:\.com)?$/i.test(normalized))
  ) {
    return normalized;
  }
  return amazonNameFromDescription(description) ?? normalized;
}

function textContent(node: HtmlTreeNode): string {
  return [
    ...node.text,
    ...node.children.map(child => textContent(child)),
  ].join(" ");
}

/**
 * Evaluates simple absolute element XPaths without adding a full DOM dependency.
 * Supported segments use the form `/tag` or `/tag[index]`.
 */
function textAtAbsoluteXPath(html: string, xpath: string): string | null {
  const path = xpath
    .split("/")
    .filter(Boolean)
    .map(segment => {
      const match = /^([a-z][\w:-]*)(?:\[(\d+)\])?$/i.exec(segment);
      if (!match) return null;
      return {
        tagName: match[1].toLowerCase(),
        index: Number(match[2] ?? "1"),
      };
    });
  if (!path.length || path.some(segment => segment == null)) return null;

  const root: HtmlTreeNode = { tagName: "#document", children: [], text: [] };
  const stack = [root];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let cursor = 0;

  for (const match of Array.from(html.matchAll(tagPattern))) {
    const current = stack[stack.length - 1];
    if (match.index! > cursor) current.text.push(html.slice(cursor, match.index));
    cursor = match.index! + match[0].length;

    if (!match[1]) continue;
    const tagName = match[1].toLowerCase();
    const isClosing = match[0].startsWith("</");
    if (isClosing) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tagName === tagName) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const node: HtmlTreeNode = { tagName, children: [], text: [] };
    current.children.push(node);
    if (!VOID_HTML_ELEMENTS.has(tagName) && !match[0].endsWith("/>")) {
      stack.push(node);
    }
  }
  stack[stack.length - 1].text.push(html.slice(cursor));

  let current = root;
  for (const segment of path) {
    if (!segment) return null;
    const matches = current.children.filter(
      child => child.tagName === segment.tagName
    );
    current = matches[segment.index - 1];
    if (!current) return null;
  }

  const value = decodeHtml(textContent(current));
  return value || null;
}

function looksLikePrice(value: string | null): boolean {
  if (!value) return false;
  return (
    /[$€£¥]|(?:^|\s)(?:USD|EUR|GBP|CAD|AUD|MAD)(?:\s|$)/i.test(value) ||
    /^\s*\d[\d.,\s]*\s*$/.test(value)
  );
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

const MAX_PERSISTED_MONEY = 99_999_999.99;

function boundedMoney(value: unknown): string | null {
  const normalized = decimal(value);
  if (!normalized || Number(normalized) > MAX_PERSISTED_MONEY) return null;
  return normalized;
}

function currencyFromPriceText(value: string | null): string | null {
  if (!value) return null;
  const code = /^([A-Z]{3})(?=\s*\d)/i.exec(value.trim())?.[1];
  if (code) return code.toUpperCase();
  if (value.includes("$")) return "USD";
  if (value.includes("€")) return "EUR";
  if (value.includes("£")) return "GBP";
  if (value.includes("¥")) return "JPY";
  return null;
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

function offerValue(offer: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (offer[key] != null) return offer[key];
  }
  return null;
}

function priceTypeValue(offer: Record<string, unknown>, html: string): string | null {
  const explicit = stringValue(offerValue(offer, ["priceType", "pricingType"]));
  if (explicit) return explicit.toLowerCase();
  if (/\b(?:member|membership|prime)\s+price\b/i.test(html)) return "membership";
  if (/\b(?:sale|deal|discount)\s+price\b/i.test(html)) return "sale";
  return null;
}

function extractCoupon(html: string, offer: Record<string, unknown>): {
  amount: string | null;
  code: string | null;
} {
  const amount =
    boundedMoney(offerValue(offer, ["couponAmount", "couponValue", "discountCoupon"])) ??
    boundedMoney(
      firstMatch(html, [
        /\bcoupon\b[^$\d]{0,40}(?:[$â‚¬Â£Â¥]\s*)?([\d.,]+)/i,
        /\bsave\b\s*(?:[$â‚¬Â£Â¥]\s*)?([\d.,]+)\s*\bwith\s+(?:coupon|promo)/i,
      ])
    );
  const rawCode = stringValue(offerValue(offer, ["couponCode", "promoCode"]));
  const code = rawCode ?? firstMatch(html, [
    /\bcoupon\b[^A-Z0-9]{0,20}(?:code\s*[:#-]?\s*)?([A-Z0-9][A-Z0-9_-]{3,})\b/i,
  ]);
  return { amount, code: code?.slice(0, 64) ?? null };
}

function nestedDecimal(value: unknown, ...keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return decimal(current);
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
  const description = meta(html, "description") ?? meta(html, "og:description");
  const htmlTitle = firstMatch(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]);
  const amazonPageTitle = isAmazonDotCom(pageUrl)
    ? firstMatch(html, [
        /<span\b[^>]*id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i,
        /<h1\b[^>]*id=["']title["'][^>]*>([\s\S]*?)<\/h1>/i,
      ])
    : null;
  const ebayProductFieldText = isEbayDotCom(pageUrl)
    ? textAtAbsoluteXPath(html, EBAY_DOT_COM_PRODUCT_FIELD_XPATH)
    : null;
  const ebayXPathName =
    ebayProductFieldText && !looksLikePrice(ebayProductFieldText)
      ? ebayProductFieldText
      : null;
  const rawName =
    ebayXPathName ??
    stringValue(jsonLdProduct?.name) ??
    amazonPageTitle ??
    ogTitle ??
    htmlTitle;
  const name = resolveProductDisplayName(rawName, pageUrl, description);
  if (ogTitle || htmlTitle) methods.push("html-metadata");
  if (ebayProductFieldText) methods.push("ebay-xpath");

  const declaredPriceType = priceTypeValue(offer, html);
  const membershipPrice =
    boundedMoney(offerValue(offer, ["membershipPrice", "memberPrice", "primePrice"])) ??
    boundedMoney(firstMatch(html, [
      /\b(?:member|membership|prime)\s+price\b[^$\d]{0,40}(?:[$â‚¬Â£Â¥]\s*)?([\d.,]+)/i,
    ]));
  const coupon = extractCoupon(html, offer);
  const membershipOnly =
    Boolean(membershipPrice) &&
    ["membership", "member", "prime"].includes(declaredPriceType ?? "") &&
    offerValue(offer, ["regularPrice", "basePrice", "listPrice", "originalPrice"]) == null;

  const amazonPriceText = isAmazonDotCom(pageUrl)
    ? textAtAbsoluteXPath(html, AMAZON_DOT_COM_PRICE_XPATH) ??
      firstMatch(html, [
        /<span\b[^>]*id=["'](?:priceblock_ourprice|priceblock_dealprice|price_inside_buybox)["'][^>]*>([\s\S]*?)<\/span>/i,
        /<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]{0,500}?<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      ])
    : null;
  const ebayPriceText =
    ebayProductFieldText && looksLikePrice(ebayProductFieldText)
      ? ebayProductFieldText
      : null;
  const walmartPriceText = isWalmartDotCom(pageUrl)
    ? textAtAbsoluteXPath(html, WALMART_DOT_COM_PRICE_XPATH)
    : null;
  const sitePriceText =
    amazonPriceText ?? ebayPriceText ?? walmartPriceText;
  const sitePrice = boundedMoney(sitePriceText);
  const extractedPrice =
    sitePrice ??
    boundedMoney(offer.price) ??
    boundedMoney(jsonLdProduct?.price) ??
    boundedMoney(meta(html, "product:price:amount")) ??
    boundedMoney(meta(html, "og:price:amount")) ??
    boundedMoney(
      firstMatch(html, [
        /\b(?:sale[-_\s]?price|current[-_\s]?price|price)\b[^>]{0,120}content=["']([^"']+)["']/i,
        /(?:[$€£¥]\s?[\d.,]+|[\d.,]+\s?(?:USD|EUR|GBP|CAD|AUD))/i,
      ])
    );
  const price = membershipOnly ? null : extractedPrice;
  const previousPrice =
    boundedMoney(offer.highPrice) ??
    boundedMoney(meta(html, "product:original_price:amount")) ??
    boundedMoney(
      firstMatch(html, [
        /<(?:del|s)\b[^>]*>([^<]{1,64})<\/(?:del|s)>/i,
        /\b(?:was|list[-_\s]?price|original[-_\s]?price)\b[^>]{0,100}>\s*([^<]+)/i,
      ])
    );
  const basePrice =
    boundedMoney(offerValue(offer, ["basePrice", "regularPrice", "listPrice", "originalPrice"])) ??
    (previousPrice && price && Number(previousPrice) > Number(price) ? previousPrice : price);
  const salePrice =
    boundedMoney(offerValue(offer, ["salePrice", "discountPrice"])) ??
    (previousPrice && price && Number(previousPrice) > Number(price) ? price : null);
  if (amazonPriceText && sitePrice) methods.push("amazon-price");
  else if (ebayPriceText && sitePrice) methods.push("ebay-price");
  else if (walmartPriceText && sitePrice) methods.push("walmart-price");
  else if (price) methods.push("price-fallback");

  const currency = (
    currencyFromPriceText(sitePriceText) ??
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
  const barcode = gtin;
  const mpn = stringValue(jsonLdProduct?.mpn) ?? meta(html, "product:mpn");
  const modelNumber =
    stringValue(jsonLdProduct?.model) ??
    meta(html, "product:model") ??
    mpn;
  const category =
    stringValue(jsonLdProduct?.category) ??
    meta(html, "product:category") ??
    firstMatch(html, [/<nav\b[^>]*(?:breadcrumb|breadcrumbs)[^>]*>([\s\S]*?)<\/nav>/i]);
  const seller = stringValue(offer.seller);
  const attributes = normalizeAttributes(
    jsonLdProduct?.additionalProperty ?? jsonLdProduct?.additionalProperties
  );
  const condition = stringValue(offer.itemCondition ?? jsonLdProduct?.itemCondition);
  const variantParts = [
    stringValue(jsonLdProduct?.color),
    stringValue(jsonLdProduct?.size),
    stringValue(jsonLdProduct?.material),
  ].filter((value): value is string => !!value);
  const variant = variantParts.length > 0 ? variantParts.join(" / ") : null;
  const quantityFromAttributes = Object.entries(attributes).find(([key]) =>
    /quantity|count|pack|units?/i.test(key)
  )?.[1];
  const quantityInfo = extractOfferQuantity(quantityFromAttributes ?? name ?? htmlTitle ?? null);
  const shippingPrice =
    boundedMoney(nestedDecimal(offer.shippingDetails, "shippingRate", "value")) ??
    boundedMoney(offer.shippingAmount) ??
    boundedMoney(meta(html, "product:shipping:amount"));
  const taxAmount = boundedMoney(offer.tax) ?? boundedMoney(offer.taxAmount);
  const discountAmount =
    price && previousPrice && Number(previousPrice) > Number(price)
      ? (Number(previousPrice) - Number(price)).toFixed(2)
      : null;
  const pageKind = jsonLdProduct || (name && price) ? "product" : classifyUrl(pageUrl);
  const confidence =
    Math.min(
      1,
      (jsonLdProduct ? 0.45 : 0) +
        (name ? 0.2 : 0) +
        (price ? 0.2 : 0) +
        (sku || gtin || mpn || modelNumber ? 0.1 : 0) +
        (images.length ? 0.05 : 0)
    );

  if (!name) warnings.push("No product name found");
  if (!price) warnings.push(membershipOnly ? "Only a membership price was available" : "No product price found");
  const product: PriceRadarProduct | null =
    pageKind === "product" && name
      ? {
          name: name.slice(0, 500),
          brand: brand?.slice(0, 255) ?? null,
          price,
          basePrice,
          salePrice,
          currency,
          previousPrice,
          discountPercent: calculateDiscount(price, previousPrice),
          productUrl: canonicalUrl,
          images: Array.from(new Set(images)).slice(0, 20),
          availability: availability(offer.availability ?? jsonLdProduct?.availability ?? html),
          sku: sku?.slice(0, 128) ?? null,
          barcode: barcode?.slice(0, 128) ?? null,
          gtin: gtin?.slice(0, 128) ?? null,
          mpn: mpn?.slice(0, 128) ?? null,
          modelNumber: modelNumber?.slice(0, 128) ?? null,
          category: category?.slice(0, 255) ?? null,
          attributes,
          rating: rating(aggregate.ratingValue),
          reviewCount: integer(aggregate.reviewCount ?? aggregate.ratingCount),
          seller: seller?.slice(0, 255) ?? null,
          condition: condition?.slice(0, 32) ?? null,
          variant: variant?.slice(0, 255) ?? null,
          quantity: quantityInfo.quantity,
          unit: quantityInfo.unit,
          shippingPrice,
          taxAmount,
          discountAmount,
          couponAmount: coupon.amount,
          couponCode: coupon.code,
          membershipPrice,
          priceType: declaredPriceType,
          structuredMetadata: Object.fromEntries(
            [
              ["openGraphTitle", ogTitle],
              ["description", description],
              ["canonical", canonicalUrl],
              ["shippingPrice", shippingPrice],
              ["taxAmount", taxAmount],
              ["basePrice", basePrice],
              ["salePrice", salePrice],
              ["couponAmount", coupon.amount],
              ["couponCode", coupon.code],
              ["membershipPrice", membershipPrice],
              ["priceType", declaredPriceType],
              ["condition", condition],
              ["variant", variant],
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
  if (
    result.product &&
    (isAmazonDotCom(result.product.productUrl) ||
      isEbayDotCom(result.product.productUrl) ||
      isWalmartDotCom(result.product.productUrl)) &&
    !result.product.price
  ) {
    return true;
  }
  if (result.product && !result.product.price) return true;
  if (result.product?.price) return false;
  return (
    html.length < 1500 ||
    /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html) ||
    /enable javascript|javascript is required|please turn on javascript/i.test(html)
  );
}
