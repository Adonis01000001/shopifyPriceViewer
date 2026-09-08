import { createHash } from "node:crypto";

export const EXTRACTOR_VERSION = "1.4.0";

export type DeterministicSource =
  | "json-ld"
  | "product-meta"
  | "shopify-json"
  | "embedded-json"
  | "semantic-html"
  | "page-text";

export type PriceKind =
  | "current"
  | "sale"
  | "original"
  | "shipping"
  | "subscription"
  | "installment"
  | "unit"
  | "bundle"
  | "related"
  | "discount"
  | "unknown";

export type EvidenceSource =
  | "jsonld"
  | "shopify"
  | "embedded_state"
  | "opengraph"
  | "meta"
  | "semantic_html"
  | "visible_text"
  | "url"
  | "other";

export type EvidenceField =
  | "product"
  | "product_id"
  | "title"
  | "brand"
  | "vendor"
  | "sku"
  | "gtin"
  | "mpn"
  | "handle"
  | "variant"
  | "variant_id"
  | "variant_option"
  | "price"
  | "compare_at_price"
  | "currency";

export interface ExtractionEvidence {
  source: EvidenceSource;
  field: EvidenceField;
  value: unknown;
  confidence: number;
  context?: string;
  selector?: string;
  rawValue?: string;
}

export type ResolutionState = "confident" | "ambiguous" | "unresolved";

export type ExtractionFailureReason =
  | "missing_product_identity"
  | "missing_price"
  | "missing_currency"
  | "variant_ambiguity"
  | "price_conflict"
  | "product_conflict"
  | "related_product_confusion"
  | "unsupported_page_structure"
  | "javascript_state_unrecognized"
  | "subscription_price_confusion"
  | "installment_price_confusion"
  | "shipping_price_confusion"
  | "bundle_price_confusion"
  | "low_confidence"
  | "unknown";

export interface ScoreContribution {
  signal: string;
  points: number;
  reason: string;
}

export interface ExtractionResolution {
  state: ResolutionState;
  confidence: number;
  score: number;
  breakdown: ScoreContribution[];
  failureReasons: ExtractionFailureReason[];
}

export interface PriceCandidate {
  value: number;
  currency: string | null;
  source: DeterministicSource;
  context: string;
  kind: PriceKind;
  confidence: number;
  productIdentity?: string | null;
  variant?: string | null;
}

export interface ProductIdentity {
  title: string | null;
  canonicalUrl: string | null;
  productId: string | null;
  variantId: string | null;
  handle: string | null;
  sku: string | null;
  barcode: string | null;
  mpn: string | null;
  vendor: string | null;
  brand: string | null;
}

export interface ProductCandidate {
  identity: ProductIdentity;
  source: DeterministicSource;
  sources: DeterministicSource[];
  priceCandidates: PriceCandidate[];
  description: string | null;
  features: string[];
  availability: string | null;
  variantOptions: string[];
  variantAmbiguous: boolean;
  score: number;
  context: string;
}

export interface DeterministicProductData {
  title: string | null;
  description: string | null;
  features: string[];
  price: number | null;
  currency: string | null;
  salePrice: number | null;
  originalPrice: number | null;
  availability: string | null;
  sku: string | null;
  barcode: string | null;
  vendor: string | null;
  source: DeterministicSource;
  structured: boolean;
  productIdentity: ProductIdentity;
  candidates: ProductCandidate[];
  priceCandidates: PriceCandidate[];
  priceConflict: boolean;
  priceConflictResolved: boolean;
  variantAmbiguous: boolean;
  evidenceScore: number;
  independentPriceSources: number;
  evidence: string[];
  productEvidence: ExtractionEvidence[];
  variantEvidence: ExtractionEvidence[];
  priceEvidence: ExtractionEvidence[];
  resolution: ExtractionResolution;
  extractorVersion: string;
}

export interface ProductMatchAssessment {
  isMatch: boolean;
  confidence: number;
  matchConfidence: number;
  skuMatchConfidence: number;
  titleSimilarity: number;
  variantSimilarity: number;
  highConfidence: boolean;
  modelExact: boolean;
  vendorMatches: boolean;
  deterministicMatch: boolean;
  resolution: ExtractionResolution;
}

export interface DeterministicExtractionOptions {
  pageUrl?: string;
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "د.م.": "MAD",
};

const COMMON_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "MAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "BRL",
  "MXN",
  "INR",
  "AED",
  "SAR",
  "NZD",
]);

const SOURCE_AUTHORITY: Record<DeterministicSource, number> = {
  "shopify-json": 5,
  "json-ld": 4,
  "embedded-json": 4,
  "semantic-html": 3,
  "product-meta": 2,
  "page-text": 1,
};

const EXCLUDED_KINDS = new Set<PriceKind>([
  "shipping",
  "subscription",
  "installment",
  "unit",
  "bundle",
  "related",
  "discount",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = decodeEntities(
    String(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
  return cleaned || null;
}

export function parsePrice(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.replace(/[^\d.,-]/g, "").trim();
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    normalized = normalized
      .replace(decimal === "," ? /\./g : /,/g, "")
      .replace(decimal, ".");
  } else if (lastComma >= 0) {
    const digitsAfter = normalized.length - lastComma - 1;
    normalized =
      digitsAfter === 2
        ? normalized.replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    const parts = normalized.split(".");
    const tail = parts.pop();
    normalized = `${parts.join("")}.${tail}`;
  }
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeCurrency(value: unknown, priceText = ""): string | null {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (COMMON_CURRENCIES.has(upper)) return upper;
    if (CURRENCY_BY_SYMBOL[value.trim()])
      return CURRENCY_BY_SYMBOL[value.trim()];
  }
  for (const [symbol, currency] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (priceText.includes(symbol)) return currency;
  }
  const code = priceText.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
  return code && COMMON_CURRENCIES.has(code) ? code : null;
}

function normalizedTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(
      token =>
        token.length > 1 && !["the", "and", "with", "for"].includes(token)
    );
}

function normalizedIdentity(value: string | null | undefined): string {
  return normalizedTokens(value).join(" ");
}

function sameValue(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.01;
}

function findObjects(
  value: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  found: Record<string, unknown>[]
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => findObjects(item, predicate, found));
    return;
  }
  const object = value as Record<string, unknown>;
  if (predicate(object)) found.push(object);
  Object.values(object).forEach(child => findObjects(child, predicate, found));
}

function productType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some(type => String(type).toLowerCase() === "product");
}

function isProductObject(value: Record<string, unknown>): boolean {
  return (
    productType(value["@type"]) ||
    (Array.isArray(value.variants) && Boolean(value.name ?? value.title))
  );
}

function readMeta(content: string): Map<string, string> {
  const result = new Map<string, string>();
  (content.match(/<meta\b[^>]*>/gi) ?? []).forEach(tag => {
    const attrs = new Map<string, string>();
    Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)).forEach(
      match => {
        attrs.set(match[1].toLowerCase(), decodeEntities(match[3]));
      }
    );
    const key =
      attrs.get("property") ?? attrs.get("name") ?? attrs.get("itemprop");
    const value = attrs.get("content");
    if (key && value && !result.has(key.toLowerCase()))
      result.set(key.toLowerCase(), value);
  });
  return result;
}

function scriptBlocks(
  content: string
): Array<{ type: string; attributes: string; text: string }> {
  return Array.from(
    content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
  ).map(match => ({
    type:
      match[1].match(/type\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase() ?? "",
    attributes: match[1],
    text: match[2].trim(),
  }));
}

function canonicalUrlFromContent(content: string): string | null {
  const tag = content.match(
    /<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i
  )?.[0];
  return tag?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
}

function pageTitleFromContent(
  content: string,
  meta: Map<string, string>
): string | null {
  const h1 = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return cleanText(
    h1 ??
      meta.get("og:title") ??
      meta.get("twitter:title") ??
      content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      content
        .split(/\r?\n/)
        .find(line => /^#\s+\S/.test(line))
        ?.replace(/^#\s+/, "")
  );
}

function classifyPrice(
  context: string,
  explicit: PriceKind = "unknown"
): PriceKind {
  if (explicit !== "unknown") return explicit;
  const lower = context.toLowerCase();
  const local = lower.split("|")[0];
  const scan = local.trim() || lower;
  if (
    /\$0(?:\.00)?\b/.test(scan) &&
    /subscriber|subscription|renews|membership/.test(lower)
  )
    return "subscription";
  if (/shipping|delivery|postage|freight|handling/.test(scan))
    return "shipping";
  if (/subscription|subscribe|monthly|per month|\/month|recurring/.test(scan))
    return "subscription";
  if (
    /installment|afterpay|affirm|klarna|pay in \d|\d+ payments?|interest-free|\/mo\b/.test(
      scan
    )
  )
    return "installment";
  if (/per unit|unit price|\/[a-z]{1,3}\b|\bkg\b|\b100 ?g\b/.test(scan))
    return "unit";
  if (/bundle|pack of|\bset of|each\b|together/.test(scan)) return "bundle";
  if (/related|recommended|you may also like|customers also/.test(scan))
    return "related";
  if (/save|discount|you save/.test(scan)) return "discount";
  if (
    /was\b|old price|original price|compare(?:d)? at|list price|regular price|rrp|msrp/.test(
      scan
    )
  )
    return "original";
  if (/now\b|sale price|special price|offer price|clearance/.test(scan))
    return "sale";
  return "current";
}

function priceCandidate(
  value: unknown,
  currency: unknown,
  source: DeterministicSource,
  context: string,
  explicitKind: PriceKind = "unknown",
  productIdentity?: string | null,
  variant?: string | null
): PriceCandidate | null {
  const parsed = parsePrice(value);
  if (parsed == null) return null;
  const kind = classifyPrice(context, explicitKind);
  const confidence = Math.max(
    0.1,
    Math.min(
      0.99,
      SOURCE_AUTHORITY[source] / 5 +
        (EXCLUDED_KINDS.has(kind) ? -0.35 : 0) +
        (kind === "current" || kind === "sale" ? 0.03 : 0)
    )
  );
  return {
    value: parsed,
    currency: normalizeCurrency(currency, String(value ?? "")),
    source,
    context: context.slice(0, 300),
    kind,
    confidence,
    productIdentity: productIdentity ?? null,
    variant: variant ?? null,
  };
}

function identityFromObject(object: Record<string, unknown>): ProductIdentity {
  const brandValue = object.brand ?? object.vendor;
  const brand = cleanText(
    brandValue && typeof brandValue === "object"
      ? (brandValue as Record<string, unknown>).name
      : brandValue
  );
  return {
    title: cleanText(object.name ?? object.title ?? object.headline),
    canonicalUrl: cleanText(
      object.url ?? object.productUrl ?? object.canonicalUrl
    ),
    productId: cleanText(object.productId ?? object.id),
    variantId: cleanText(object.variantId ?? object.selectedVariantId),
    handle: cleanText(object.handle),
    sku: cleanText(object.sku),
    barcode: cleanText(
      object.gtin13 ??
        object.gtin12 ??
        object.gtin14 ??
        object.gtin ??
        object.barcode
    ),
    mpn: cleanText(object.mpn),
    vendor: cleanText(object.vendor),
    brand,
  };
}

function mergeIdentity(
  left: ProductIdentity,
  right: ProductIdentity
): ProductIdentity {
  return {
    title: left.title ?? right.title,
    canonicalUrl: left.canonicalUrl ?? right.canonicalUrl,
    productId: left.productId ?? right.productId,
    variantId: left.variantId ?? right.variantId,
    handle: left.handle ?? right.handle,
    sku: left.sku ?? right.sku,
    barcode: left.barcode ?? right.barcode,
    mpn: left.mpn ?? right.mpn,
    vendor: left.vendor ?? right.vendor,
    brand: left.brand ?? right.brand,
  };
}

function variantLabel(variant: Record<string, unknown>): string | null {
  const options = Array.isArray(variant.options)
    ? variant.options
        .map(cleanText)
        .filter((value): value is string => Boolean(value))
    : [variant.option1, variant.option2, variant.option3]
        .map(cleanText)
        .filter((value): value is string => Boolean(value));
  return options.length
    ? options.join(" / ")
    : cleanText(variant.title ?? variant.name);
}

function shopifyMoney(value: unknown): number | null {
  const parsed = parsePrice(value);
  if (parsed == null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1000
    ? parsed / 100
    : parsed;
}

function selectedVariantId(content: string, pageUrl?: string): string | null {
  return (
    pageUrl?.match(/[?&]variant=(\d+)/i)?.[1] ??
    content.match(
      /(?:selectedVariantId|selected_variant_id|variantId)\D+(\d+)/i
    )?.[1] ??
    null
  );
}

function candidateFromObject(
  object: Record<string, unknown>,
  source: DeterministicSource,
  context: string,
  options?: DeterministicExtractionOptions
): ProductCandidate | null {
  const identity = identityFromObject(object);
  if (!identity.title && !identity.productId && !identity.sku) return null;
  const productKey = identity.productId ?? identity.sku ?? identity.title;
  const candidates: PriceCandidate[] = [];
  const rawOffers = object.offers ?? object.offer;
  const offers = Array.isArray(rawOffers)
    ? rawOffers
    : rawOffers
      ? [rawOffers]
      : [];
  offers.forEach(rawOffer => {
    if (!rawOffer || typeof rawOffer !== "object") return;
    const offer = rawOffer as Record<string, unknown>;
    const offerContext = `${context} ${cleanText(offer.name) ?? ""}`;
    const offerCurrency = offer.priceCurrency ?? object.priceCurrency;
    const currentOffer = priceCandidate(
      offer.price ?? offer.lowPrice,
      offerCurrency,
      source,
      offerContext,
      "unknown",
      productKey
    );
    if (currentOffer) candidates.push(currentOffer);
    const specifications = Array.isArray(offer.priceSpecification)
      ? offer.priceSpecification
      : offer.priceSpecification
        ? [offer.priceSpecification]
        : [];
    specifications.forEach(rawSpecification => {
      if (!rawSpecification || typeof rawSpecification !== "object") return;
      const spec = rawSpecification as Record<string, unknown>;
      const priceType = String(spec.priceType ?? "").toLowerCase();
      const kind: PriceKind = /list|compare|regular|rrp|msrp/.test(priceType)
        ? "original"
        : "unknown";
      const value = priceCandidate(
        spec.price,
        spec.priceCurrency ?? offerCurrency,
        source,
        `${offerContext} ${priceType}`,
        kind,
        productKey
      );
      if (value) candidates.push(value);
    });
  });
  const direct = priceCandidate(
    object.price,
    object.priceCurrency ?? object.currency,
    source,
    context,
    "unknown",
    productKey
  );
  if (direct) candidates.push(direct);

  const variants = Array.isArray(object.variants) ? object.variants : [];
  const wantedVariantId = selectedVariantId(context, options?.pageUrl);
  const selected = variants.find(rawVariant => {
    if (!rawVariant || typeof rawVariant !== "object") return false;
    const variant = rawVariant as Record<string, unknown>;
    return (
      Boolean(variant.selected ?? variant.isSelected) ||
      (wantedVariantId != null &&
        String(variant.id ?? variant.variantId) === wantedVariantId)
    );
  }) as Record<string, unknown> | undefined;
  const usableVariants = variants
    .map(rawVariant => {
      if (!rawVariant || typeof rawVariant !== "object") return null;
      const variant = rawVariant as Record<string, unknown>;
      const label = variantLabel(variant);
      const current = priceCandidate(
        shopifyMoney(variant.price),
        variant.priceCurrency ?? object.currency,
        source,
        `${context} variant ${label ?? ""}`,
        "unknown",
        productKey,
        label
      );
      const compare = priceCandidate(
        shopifyMoney(variant.compare_at_price ?? variant.compareAtPrice),
        variant.priceCurrency ?? object.currency,
        source,
        `${context} variant ${label ?? ""} compare at`,
        "original",
        productKey,
        label
      );
      return { variant, label, current, compare };
    })
    .filter(
      (
        value
      ): value is {
        variant: Record<string, unknown>;
        label: string | null;
        current: PriceCandidate | null;
        compare: PriceCandidate | null;
      } => Boolean(value)
    );
  const variantValues = usableVariants
    .map(value => value.current?.value)
    .filter((value): value is number => value != null);
  const differentVariantPrices = variantValues.some(value =>
    variantValues.some(other => !sameValue(value, other))
  );
  const selectedVariant = selected
    ? usableVariants.find(
        value =>
          value.variant === selected ||
          String(value.variant.id ?? "") === String(selected.id ?? "")
      )
    : !differentVariantPrices
      ? usableVariants[0]
      : undefined;
  if (selectedVariant) {
    if (selectedVariant.current) candidates.push(selectedVariant.current);
    if (selectedVariant.compare) candidates.push(selectedVariant.compare);
    identity.variantId = cleanText(
      selectedVariant.variant.id ?? selectedVariant.variant.variantId
    );
    identity.sku = identity.sku ?? cleanText(selectedVariant.variant.sku);
    identity.barcode =
      identity.barcode ?? cleanText(selectedVariant.variant.barcode);
  }
  const ambiguous =
    variants.length > 1 && !selectedVariant && differentVariantPrices;
  const variantOptions = usableVariants
    .map(value => value.label)
    .filter((value): value is string => Boolean(value));
  const bestPrice = candidates
    .slice()
    .sort((left, right) => right.confidence - left.confidence)[0];
  const related = /related|recommended|you may also like|customers also/.test(
    context.toLowerCase()
  );
  const score =
    SOURCE_AUTHORITY[source] / 5 +
    (identity.title ? 0.12 : 0) +
    (bestPrice ? 0.12 : 0) +
    (identity.productId || identity.sku ? 0.1 : 0) -
    (related ? 0.45 : 0) -
    (ambiguous ? 0.2 : 0);
  return {
    identity,
    source,
    sources: [source],
    priceCandidates: candidates,
    description: cleanText(object.description ?? object.body_html),
    features: Array.isArray(object.additionalProperty)
      ? object.additionalProperty
          .map(item => cleanText((item as Record<string, unknown>)?.value))
          .filter((value): value is string => Boolean(value))
          .slice(0, 12)
      : [],
    availability: cleanText(
      object.availability ?? selectedVariant?.variant.available
    ),
    variantOptions,
    variantAmbiguous: Boolean(ambiguous),
    score,
    context,
  };
}

function jsonLdCandidates(
  content: string,
  options?: DeterministicExtractionOptions
): ProductCandidate[] {
  const found: ProductCandidate[] = [];
  scriptBlocks(content)
    .filter(block => block.type === "application/ld+json")
    .forEach(block => {
      try {
        const products: Record<string, unknown>[] = [];
        findObjects(
          JSON.parse(decodeEntities(block.text)),
          value => productType(value["@type"]),
          products
        );
        products.forEach(product => {
          const candidate = candidateFromObject(
            product,
            "json-ld",
            "Schema.org Product JSON-LD",
            options
          );
          if (candidate) found.push(candidate);
        });
      } catch {
        /* invalid JSON-LD is untrusted input */
      }
    });
  return found;
}

function shopifyCandidates(
  content: string,
  options?: DeterministicExtractionOptions
): ProductCandidate[] {
  const found: ProductCandidate[] = [];
  scriptBlocks(content)
    .filter(block => block.type === "application/json" || block.type === "")
    .forEach(block => {
      try {
        const products: Record<string, unknown>[] = [];
        findObjects(
          JSON.parse(decodeEntities(block.text)),
          isProductObject,
          products
        );
        products.forEach(product => {
          const candidate = candidateFromObject(
            product,
            "shopify-json",
            "Shopify product/variant JSON",
            options
          );
          if (candidate) found.push(candidate);
        });
      } catch {
        /* invalid application state is untrusted input */
      }
    });
  return found;
}

function embeddedCandidates(
  content: string,
  options?: DeterministicExtractionOptions
): ProductCandidate[] {
  const found: ProductCandidate[] = [];
  scriptBlocks(content).forEach(block => {
    try {
      const assignment = block.text.match(
        /(?:window\.[\w$.]+|(?:var|let|const)\s+\w+)\s*=\s*((?:\{|\[)[\s\S]*(?:\}|\]))\s*;?$/
      );
      const jsonText =
        assignment?.[1] ??
        (block.type === "application/json" ||
        block.type === "text/json" ||
        block.type === ""
          ? block.text
          : "");
      if (!jsonText) return;
      const products: Record<string, unknown>[] = [];
      findObjects(
        JSON.parse(decodeEntities(jsonText)),
        object => {
          const looksLikeVariant = Boolean(
            object.id &&
              (object.title || object.name) &&
              object.price &&
              !object.productId &&
              !object.handle &&
              !object.variants &&
              !object.offers
          );
          return (
            !looksLikeVariant &&
            Boolean(
              (object.name ?? object.title) &&
                (object.price ?? object.offers ?? object.variants)
            )
          );
        },
        products
      );
      products.forEach(product => {
        const candidate = candidateFromObject(
          product,
          "embedded-json",
          "embedded application state",
          options
        );
        if (candidate) found.push(candidate);
      });
    } catch {
      /* invalid state is untrusted input */
    }
  });
  return found;
}

function metaCandidate(content: string): ProductCandidate | null {
  const meta = readMeta(content);
  const identity: ProductIdentity = {
    title: cleanText(meta.get("og:title") ?? meta.get("twitter:title")),
    canonicalUrl: canonicalUrlFromContent(content),
    productId: null,
    variantId: null,
    handle: null,
    sku: cleanText(meta.get("product:retailer_item_id") ?? meta.get("sku")),
    barcode: cleanText(meta.get("gtin13") ?? meta.get("gtin")),
    mpn: null,
    vendor: cleanText(meta.get("product:brand") ?? meta.get("brand")),
    brand: cleanText(meta.get("product:brand") ?? meta.get("brand")),
  };
  const price = priceCandidate(
    meta.get("product:price:amount") ??
      meta.get("og:price:amount") ??
      meta.get("price"),
    meta.get("product:price:currency") ?? meta.get("og:price:currency"),
    "product-meta",
    "OpenGraph/product meta price"
  );
  if (!identity.title && !price) return null;
  return {
    identity,
    source: "product-meta",
    sources: ["product-meta"],
    priceCandidates: price ? [price] : [],
    description: cleanText(
      meta.get("og:description") ?? meta.get("description")
    ),
    features: [],
    availability: cleanText(
      meta.get("product:availability") ?? meta.get("availability")
    ),
    variantOptions: [],
    variantAmbiguous: false,
    score: 0.55 + (price ? 0.12 : 0) + (identity.title ? 0.12 : 0),
    context: "OpenGraph/product meta",
  };
}

function semanticCandidate(content: string): ProductCandidate | null {
  // Use the whole document for itemprop lookup. A naive non-greedy scope
  // match would stop at the first nested closing tag (often the title) and
  // silently lose the price/currency metadata that follows it.
  const scope = content;
  const value = (prop: string) =>
    scope.match(
      new RegExp(
        `itemprop=["']${prop}["'][^>]*(?:content=["']([^"']+)|>([^<]+))`,
        "i"
      )
    );
  const title = cleanText(value("name")?.[1] ?? value("name")?.[2]);
  const rawPrice = value("price");
  const currency = value("priceCurrency");
  const price = priceCandidate(
    rawPrice?.[1] ?? rawPrice?.[2],
    currency?.[1] ?? currency?.[2],
    "semantic-html",
    "semantic Product price"
  );
  if (!title && !price) return null;
  const sku = value("sku");
  return {
    identity: {
      title,
      canonicalUrl: canonicalUrlFromContent(content),
      productId: null,
      variantId: null,
      handle: null,
      sku: cleanText(sku?.[1] ?? sku?.[2]),
      barcode: null,
      mpn: null,
      vendor: null,
      brand: null,
    },
    source: "semantic-html",
    sources: ["semantic-html"],
    priceCandidates: price ? [price] : [],
    description: null,
    features: [],
    availability: null,
    variantOptions: [],
    variantAmbiguous: false,
    score: 0.8 + (price ? 0.1 : 0),
    context: "semantic Product HTML",
  };
}

function textCandidate(
  content: string,
  options?: DeterministicExtractionOptions
): ProductCandidate | null {
  const meta = readMeta(content);
  const title = pageTitleFromContent(content, meta);
  const lines = content
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  const priceRows: Array<{
    candidate: PriceCandidate;
    index: number;
    line: string;
  }> = [];
  lines.forEach((line, index) => {
    const nearby = lines
      .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
      .join(" ");
    Array.from(
      line.matchAll(
        /(?:[$€£¥]\s*)\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP|CAD|AUD|MAD|JPY|CHF)\b/gi
      )
    ).forEach(match => {
      const localContext = `${line.slice(0, match.index ?? 0)} ${match[0]}`;
      const candidate = priceCandidate(
        match[0],
        null,
        "page-text",
        `${localContext} | nearby: ${nearby}`
      );
      if (candidate) priceRows.push({ candidate, index, line });
    });
  });
  let selectedRows = priceRows;
  const anchorText = title ?? options?.pageUrl ?? null;
  const titleTokens = new Set(normalizedTokens(anchorText));
  const titleOverlap = (line: string) =>
    normalizedTokens(line).filter(token => titleTokens.has(token)).length;
  const titleLineIndex = anchorText
    ? (() => {
        const minimumOverlap = Math.min(3, Math.max(1, titleTokens.size));
        const markdownHeading = lines.findIndex(
          line => /^#\s+\S/.test(line) && titleOverlap(line) >= minimumOverlap
        );
        if (markdownHeading >= 0) return markdownHeading;
        let bestIndex = -1;
        let bestOverlap = 0;
        lines.forEach((line, index) => {
          const overlap = titleOverlap(line);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestIndex = index;
          }
        });
        return bestIndex;
      })()
    : -1;

  // Jina's readable output commonly puts the main product price next to the
  // heading, followed by recommendations, warranty plans, and other product
  // prices. If there are many candidates, keep only the small heading window;
  // this prevents unrelated prices from creating a false conflict.
  if (priceRows.length > 8 && titleLineIndex >= 0) {
    selectedRows = priceRows.filter(
      row => Math.abs(row.index - titleLineIndex) <= 30
    );
  }

  // Some storefronts render sale and compare-at values as two unlabeled
  // amounts on the product heading. Treat the lower amount as the sale price
  // and the higher amount as the compare-at price only in that exact, local
  // context; other ambiguous price sets remain rejected.
  const headingRows = selectedRows.filter(row => row.index === titleLineIndex);
  const localProductRows = selectedRows.filter(
    row => row.index > titleLineIndex && row.index - titleLineIndex <= 30
  );
  const mainPriceRows =
    headingRows.length === 2
      ? headingRows
      : localProductRows.length === 2 &&
          localProductRows[1].index - localProductRows[0].index <= 2
        ? localProductRows
        : [];
  if (
    mainPriceRows.length === 2 &&
    mainPriceRows[0].candidate.value !== mainPriceRows[1].candidate.value &&
    mainPriceRows.every(row => row.candidate.kind === "current")
  ) {
    const lower = Math.min(
      mainPriceRows[0].candidate.value,
      mainPriceRows[1].candidate.value
    );
    mainPriceRows.forEach(row => {
      row.candidate.kind = row.candidate.value === lower ? "sale" : "original";
    });
  }

  const pagePath = (() => {
    try {
      return new URL(options?.pageUrl ?? "").pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const pageUrlTokens = normalizedTokens(options?.pageUrl);
  const pageTitleTokens = normalizedTokens(title);
  const skuBearingProductUrl = /(?:^|[-_])sku[-_]/.test(pagePath);
  const modelOnProductUrl = extractModelTokens(title).some(token =>
    pageUrlTokens.includes(token)
  );
  const productPageUrl =
    (/\/(?:products?|p|dp|item|itm)[/_-]/.test(pagePath) ||
      skuBearingProductUrl) &&
    (modelOnProductUrl ||
      pageTitleTokens.filter(token => pageUrlTokens.includes(token)).length >=
        2 ||
      skuBearingProductUrl);
  if (productPageUrl && mainPriceRows.length > 0 && mainPriceRows.length <= 3) {
    selectedRows = mainPriceRows;
  }

  if (productPageUrl && titleLineIndex >= 0) {
    const primaryRow = selectedRows
      .filter(
        row =>
          row.index >= titleLineIndex &&
          row.index - titleLineIndex <= 12 &&
          !EXCLUDED_KINDS.has(row.candidate.kind)
      )
      .sort((left, right) => left.index - right.index)[0];
    if (primaryRow) {
      const primaryLineRows = selectedRows.filter(
        row => row.index === primaryRow.index
      );
      if (primaryLineRows.length > 0 && primaryLineRows.length <= 3) {
        const primaryCurrentRows = primaryLineRows.filter(
          row => row.candidate.kind === "current"
        );
        if (
          primaryCurrentRows.length === 2 &&
          primaryCurrentRows[0].candidate.value !==
            primaryCurrentRows[1].candidate.value &&
          (skuBearingProductUrl ||
            /sale|save|regular|was|now|compare|msrp|off/.test(
              primaryLineRows
                .map(row => row.candidate.context)
                .join(" ")
                .toLowerCase()
            ))
        ) {
          const lower = Math.min(
            primaryCurrentRows[0].candidate.value,
            primaryCurrentRows[1].candidate.value
          );
          primaryCurrentRows.forEach(row => {
            row.candidate.kind =
              row.candidate.value === lower ? "sale" : "original";
          });
        }
        selectedRows = primaryLineRows;
      }
    }
  }

  if (productPageUrl) {
    const primaryRow = selectedRows
      .filter(row => !EXCLUDED_KINDS.has(row.candidate.kind))
      .sort((left, right) => left.index - right.index)[0];
    if (primaryRow) {
      const primaryLineRows = selectedRows.filter(
        row => row.index === primaryRow.index
      );
      if (primaryLineRows.length > 0 && primaryLineRows.length <= 3) {
        const primaryCurrentRows = primaryLineRows.filter(
          row => row.candidate.kind === "current"
        );
        if (
          primaryCurrentRows.length === 2 &&
          primaryCurrentRows[0].candidate.value !==
            primaryCurrentRows[1].candidate.value &&
          (skuBearingProductUrl ||
            /sale|save|regular|was|now|compare|msrp|off/.test(
              primaryLineRows
                .map(row => row.candidate.context)
                .join(" ")
                .toLowerCase()
            ))
        ) {
          const lower = Math.min(
            primaryCurrentRows[0].candidate.value,
            primaryCurrentRows[1].candidate.value
          );
          primaryCurrentRows.forEach(row => {
            row.candidate.kind =
              row.candidate.value === lower ? "sale" : "original";
          });
        }
        selectedRows = primaryLineRows;
      }
    }
  }

  // Sparse retailer pages often put the real product price beside a SKU,
  // model, or item-number label, then list accessories and recommendations
  // with equally plausible visible prices. When that product identifier is
  // close to the page title, keep only that small price cluster. This is an
  // evidence-based narrowing step; pages without the anchor remain fully
  // ambiguous and continue through the normal fallback path.
  const productIdentifierAnchor =
    /\b(?:sku|model|mpn|item\s*(?:number|no\.?|#)|product\s*(?:code|number|no\.?|#)|part\s*(?:number|no\.?|#))\b/i;
  if (titleLineIndex >= 0) {
    const anchoredRows = selectedRows.filter(
      row =>
        row.index >= titleLineIndex &&
        row.index - titleLineIndex <= 8 &&
        productIdentifierAnchor.test(row.candidate.context)
    );
    if (anchoredRows.length > 0 && anchoredRows.length <= 3) {
      selectedRows = anchoredRows;
    }
  }

  const prices = selectedRows.map(row => row.candidate);
  if (!title && prices.length === 0) return null;
  return {
    identity: {
      title,
      canonicalUrl: canonicalUrlFromContent(content),
      productId: null,
      variantId: null,
      handle: null,
      sku: null,
      barcode: null,
      mpn: null,
      vendor: null,
      brand: null,
    },
    source: "page-text",
    sources: ["page-text"],
    priceCandidates: prices,
    description: null,
    features: [],
    availability: null,
    variantOptions: [],
    variantAmbiguous: false,
    score: 0.38 + (title ? 0.1 : 0),
    context: "relevant product page text",
  };
}

function identityKey(candidate: ProductCandidate): string {
  const identity = candidate.identity;
  return (
    normalizedIdentity(
      identity.title ?? identity.sku ?? identity.barcode ?? identity.productId
    ) || `source:${candidate.source}`
  );
}

export function buildProductCandidates(
  raw: ProductCandidate[]
): ProductCandidate[] {
  const groups = new Map<string, ProductCandidate>();
  raw.forEach(candidate => {
    const key = identityKey(candidate);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...candidate,
        priceCandidates: [...candidate.priceCandidates],
        sources: [...candidate.sources],
      });
      return;
    }
    existing.identity = mergeIdentity(existing.identity, candidate.identity);
    existing.sources = Array.from(
      new Set([...existing.sources, ...candidate.sources])
    );
    existing.priceCandidates.push(...candidate.priceCandidates);
    existing.description = existing.description ?? candidate.description;
    existing.features = Array.from(
      new Set([...existing.features, ...candidate.features])
    ).slice(0, 12);
    existing.availability = existing.availability ?? candidate.availability;
    existing.variantOptions = Array.from(
      new Set([...existing.variantOptions, ...candidate.variantOptions])
    );
    existing.variantAmbiguous ||= candidate.variantAmbiguous;
    existing.score = Math.max(existing.score, candidate.score) + 0.08;
  });
  return Array.from(groups.values());
}

export function resolvePrice(candidate: ProductCandidate) {
  const usable = candidate.priceCandidates.filter(
    item => !EXCLUDED_KINDS.has(item.kind)
  );
  const current = usable.filter(
    item =>
      item.kind === "current" || item.kind === "sale" || item.kind === "unknown"
  );
  const values = Array.from(
    new Set(current.map(item => item.value.toFixed(2)))
  );
  const groups = values.map(value =>
    current.filter(item => item.value.toFixed(2) === value)
  );
  const groupScore = (items: PriceCandidate[]) =>
    Math.max(
      ...items.map(item => SOURCE_AUTHORITY[item.source] * 10 + item.confidence)
    ) + items.length;
  groups.sort((left, right) => groupScore(right) - groupScore(left));
  const winner = groups[0] ?? [];
  const runnerUp = groups[1] ?? [];
  const winnerAuthority = winner.length
    ? Math.max(...winner.map(item => SOURCE_AUTHORITY[item.source]))
    : 0;
  const runnerAuthority = runnerUp.length
    ? Math.max(...runnerUp.map(item => SOURCE_AUTHORITY[item.source]))
    : 0;
  const conflict = groups.length > 1;
  const currentPrice = winner[0] ?? null;
  const sourceCount = new Set(winner.map(item => item.source)).size;
  const original =
    usable
      .filter(item => item.kind === "original")
      .sort(
        (left, right) =>
          SOURCE_AUTHORITY[right.source] - SOURCE_AUTHORITY[left.source]
      )[0] ?? null;
  const evidenceScore = Math.max(
    0,
    Math.min(
      1,
      candidate.score / 1.4 +
        (currentPrice ? 0.12 : 0) +
        (sourceCount > 1 ? 0.12 : 0) +
        (!conflict || winnerAuthority > runnerAuthority ? 0.03 : -0.18) -
        (candidate.variantAmbiguous ? 0.2 : 0)
    )
  );
  return {
    current: currentPrice,
    original,
    conflict,
    conflictResolved: !conflict || winnerAuthority > runnerAuthority,
    independentSources: sourceCount,
    evidenceScore,
  };
}

export function extractEvidence(
  content: string,
  options?: DeterministicExtractionOptions
): ProductCandidate[] {
  const metaProduct = metaCandidate(content);
  const semanticProduct = semanticCandidate(content);
  const textProduct = textCandidate(content, options);
  return [
    ...jsonLdCandidates(content, options),
    ...shopifyCandidates(content, options),
    ...embeddedCandidates(content, options),
    ...(metaProduct ? [metaProduct] : []),
    ...(semanticProduct ? [semanticProduct] : []),
    ...(textProduct ? [textProduct] : []),
  ];
}

export interface ProductIdentityResolution {
  selected: ProductCandidate;
  productConflict: boolean;
}

export function resolveProductIdentity(
  candidates: ProductCandidate[],
  pageTitle: string | null
): ProductIdentityResolution {
  candidates.sort((left, right) => {
    const titleBoost = (candidate: ProductCandidate) => {
      const pageTokens = new Set(normalizedTokens(pageTitle));
      return (
        normalizedTokens(candidate.identity.title).filter(token =>
          pageTokens.has(token)
        ).length * 0.02
      );
    };
    return right.score + titleBoost(right) - (left.score + titleBoost(left));
  });
  const selected = candidates[0];
  const runnerUp = candidates[1];
  const selectedId = selected.identity.productId;
  const runnerUpId = runnerUp?.identity.productId;
  const productConflict = Boolean(
    runnerUp &&
      selectedId &&
      runnerUpId &&
      normalizedIdentity(selectedId) !== normalizedIdentity(runnerUpId) &&
      Math.abs(selected.score - runnerUp.score) <= 0.1
  );
  return { selected, productConflict };
}

export function resolveVariant(candidate: ProductCandidate) {
  return {
    variantId: candidate.identity.variantId,
    options: [...candidate.variantOptions],
    ambiguous: candidate.variantAmbiguous,
  };
}

function evidenceSource(source: DeterministicSource): EvidenceSource {
  switch (source) {
    case "json-ld":
      return "jsonld";
    case "shopify-json":
      return "shopify";
    case "embedded-json":
      return "embedded_state";
    case "product-meta":
      return "meta";
    case "semantic-html":
      return "semantic_html";
    case "page-text":
      return "visible_text";
  }
}

function compactContext(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function uniqueEvidence(items: ExtractionEvidence[]): ExtractionEvidence[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = JSON.stringify([
      item.source,
      item.field,
      item.value,
      item.context,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedEvidence(
  rawCandidates: ProductCandidate[],
  selected: ProductCandidate,
  pageUrl?: string
) {
  const selectedKey = identityKey(selected);
  const contributing = rawCandidates.filter(
    candidate => identityKey(candidate) === selectedKey
  );
  const candidates = contributing.length > 0 ? contributing : [selected];
  const productEvidence: ExtractionEvidence[] = [];
  const variantEvidence: ExtractionEvidence[] = [];
  const priceEvidence: ExtractionEvidence[] = [];
  const identityFields: Array<[keyof ProductIdentity, EvidenceField]> = [
    ["title", "title"],
    ["canonicalUrl", "product"],
    ["productId", "product_id"],
    ["handle", "handle"],
    ["sku", "sku"],
    ["barcode", "gtin"],
    ["mpn", "mpn"],
    ["vendor", "vendor"],
    ["brand", "brand"],
  ];

  for (const candidate of candidates) {
    const source = evidenceSource(candidate.source);
    const confidence = Math.max(0, Math.min(1, candidate.score));
    for (const [identityField, field] of identityFields) {
      const value = candidate.identity[identityField];
      if (value == null || value === "") continue;
      productEvidence.push({
        source,
        field,
        value,
        confidence,
        context: compactContext(candidate.context),
        rawValue: String(value).slice(0, 500),
      });
    }
    if (candidate.identity.variantId) {
      variantEvidence.push({
        source,
        field: "variant_id",
        value: candidate.identity.variantId,
        confidence,
        context: compactContext(candidate.context),
        rawValue: candidate.identity.variantId.slice(0, 500),
      });
    }
    for (const option of candidate.variantOptions) {
      variantEvidence.push({
        source,
        field: "variant_option",
        value: option,
        confidence,
        context: compactContext(candidate.context),
        rawValue: option.slice(0, 500),
      });
    }
    for (const price of candidate.priceCandidates) {
      priceEvidence.push({
        source: evidenceSource(price.source),
        field: price.kind === "original" ? "compare_at_price" : "price",
        value: price.value,
        confidence: price.confidence,
        context: compactContext(price.context),
        rawValue: String(price.value),
      });
      if (price.currency) {
        priceEvidence.push({
          source: evidenceSource(price.source),
          field: "currency",
          value: price.currency,
          confidence: price.confidence,
          context: compactContext(price.context),
          rawValue: price.currency,
        });
      }
    }
  }
  if (pageUrl) {
    productEvidence.push({
      source: "url",
      field: "product",
      value: pageUrl,
      confidence: 0.5,
      context: "requested page URL",
    });
  }
  return {
    productEvidence: uniqueEvidence(productEvidence),
    variantEvidence: uniqueEvidence(variantEvidence),
    priceEvidence: uniqueEvidence(priceEvidence),
  };
}

export function calculateConfidence(
  candidate: ProductCandidate,
  priceResolution: ReturnType<typeof resolvePrice>
): { score: number; breakdown: ScoreContribution[] } {
  const breakdown: ScoreContribution[] = [
    {
      signal: "source_reliability",
      points: (candidate.score / 1.4) * 100,
      reason: `candidate evidence from ${candidate.sources.join(", ")}`,
    },
    {
      signal: "price_present",
      points: priceResolution.current ? 12 : 0,
      reason: priceResolution.current
        ? "a usable current price was found"
        : "no usable current price was found",
    },
    {
      signal: "cross_source_agreement",
      points: priceResolution.independentSources > 1 ? 12 : 0,
      reason: `${priceResolution.independentSources} independent price source(s) agree`,
    },
    {
      signal: "price_consistency",
      points: priceResolution.conflictResolved ? 3 : -18,
      reason: priceResolution.conflictResolved
        ? "no unresolved price conflict"
        : "equally authoritative prices conflict",
    },
    {
      signal: "variant_consistency",
      points: candidate.variantAmbiguous ? -20 : 0,
      reason: candidate.variantAmbiguous
        ? "multiple variant prices exist without a selected variant"
        : "variant evidence is not contradictory",
    },
  ];
  return {
    score: priceResolution.evidenceScore * 100,
    breakdown,
  };
}

export function finalDecision(options: {
  candidate: ProductCandidate;
  priceResolution: ReturnType<typeof resolvePrice>;
  productConflict: boolean;
}): ExtractionResolution {
  const { candidate, priceResolution, productConflict } = options;
  const { score, breakdown } = calculateConfidence(candidate, priceResolution);
  const reasons = new Set<ExtractionFailureReason>();
  const identity = candidate.identity;
  if (
    !identity.title &&
    !identity.productId &&
    !identity.sku &&
    !identity.barcode
  )
    reasons.add("missing_product_identity");
  if (!priceResolution.current) reasons.add("missing_price");
  if (priceResolution.current && !priceResolution.current.currency)
    reasons.add("missing_currency");
  if (candidate.variantAmbiguous) reasons.add("variant_ambiguity");
  if (priceResolution.conflict && !priceResolution.conflictResolved)
    reasons.add("price_conflict");
  if (productConflict) reasons.add("product_conflict");
  if (!priceResolution.current) {
    const excludedKinds = new Set(
      candidate.priceCandidates.map(item => item.kind)
    );
    if (excludedKinds.has("related")) reasons.add("related_product_confusion");
    if (excludedKinds.has("subscription"))
      reasons.add("subscription_price_confusion");
    if (excludedKinds.has("installment"))
      reasons.add("installment_price_confusion");
    if (excludedKinds.has("shipping")) reasons.add("shipping_price_confusion");
    if (excludedKinds.has("bundle")) reasons.add("bundle_price_confusion");
  }
  if (candidate.sources.every(source => source === "page-text"))
    reasons.add("unsupported_page_structure");
  if (score < 78) reasons.add("low_confidence");

  const failureReasons = Array.from(reasons);
  const missingCore = failureReasons.some(reason =>
    ["missing_product_identity", "missing_price", "missing_currency"].includes(
      reason
    )
  );
  const blockingAmbiguity = failureReasons.some(reason =>
    ["variant_ambiguity", "price_conflict", "product_conflict"].includes(reason)
  );
  const state: ResolutionState = missingCore
    ? "unresolved"
    : blockingAmbiguity || score < 78
      ? "ambiguous"
      : "confident";
  return {
    state,
    confidence: Math.max(0, Math.min(1, score / 100)),
    score,
    breakdown,
    failureReasons,
  };
}

export function extractDeterministicProduct(
  content: string,
  options?: DeterministicExtractionOptions
): DeterministicProductData | null {
  const meta = readMeta(content);
  const raw = extractEvidence(content, options);
  if (raw.length === 0) return null;
  const candidates = buildProductCandidates(raw);
  const pageTitle = pageTitleFromContent(content, meta);
  const identityResolution = resolveProductIdentity(candidates, pageTitle);
  const selected = identityResolution.selected;
  const variantResolution = resolveVariant(selected);
  const reconciliation = resolvePrice(selected);
  const current = reconciliation.current;
  const original = reconciliation.original;
  const normalized = normalizedEvidence(raw, selected, options?.pageUrl);
  const resolution = finalDecision({
    candidate: selected,
    priceResolution: reconciliation,
    productConflict: identityResolution.productConflict,
  });
  const evidence = [
    `selected product source: ${selected.sources.join(", ")}`,
    current
      ? `selected current price: ${current.value.toFixed(2)} from ${current.source}`
      : "no unambiguous current price",
    ...(reconciliation.conflict
      ? ["price conflict reconciled by source authority"]
      : []),
    ...(selected.variantAmbiguous ? ["variant price is ambiguous"] : []),
  ];
  const productIdentity = {
    ...selected.identity,
    canonicalUrl: selected.identity.canonicalUrl ?? options?.pageUrl ?? null,
  };
  return {
    title: selected.identity.title ?? pageTitle,
    description: selected.description,
    features: selected.features,
    price: variantResolution.ambiguous ? null : (current?.value ?? null),
    currency: variantResolution.ambiguous
      ? null
      : (current?.currency ?? original?.currency ?? null),
    salePrice:
      variantResolution.ambiguous ||
      !current ||
      (!original && current.kind !== "sale") ||
      (original != null && current.value >= original.value)
        ? null
        : current.value,
    originalPrice: variantResolution.ambiguous
      ? null
      : (original?.value ?? null),
    availability: selected.availability,
    sku: selected.identity.sku,
    barcode: selected.identity.barcode,
    vendor: selected.identity.vendor ?? selected.identity.brand,
    source: selected.sources
      .slice()
      .sort(
        (left, right) => SOURCE_AUTHORITY[right] - SOURCE_AUTHORITY[left]
      )[0],
    structured: selected.sources.some(source => source !== "page-text"),
    productIdentity,
    candidates,
    priceCandidates: selected.priceCandidates,
    priceConflict: reconciliation.conflict,
    priceConflictResolved: reconciliation.conflictResolved,
    variantAmbiguous: variantResolution.ambiguous,
    evidenceScore: reconciliation.evidenceScore,
    independentPriceSources: reconciliation.independentSources,
    evidence,
    ...normalized,
    resolution,
    extractorVersion: EXTRACTOR_VERSION,
  };
}

function equalIdentifier(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return false;
  return (
    left.replace(/[^a-z0-9]/gi, "").toLowerCase() ===
    right.replace(/[^a-z0-9]/gi, "").toLowerCase()
  );
}

const GENERIC_MODEL_TOKENS = new Set([
  "4k",
  "5g",
  "8k",
  "bluetooth",
  "gb",
  "hd",
  "hz",
  "inch",
  "mah",
  "tb",
  "usb",
  "wifi",
  "wireless",
]);

/**
 * Product titles often contain the only public model identifier. Keep this
 * intentionally conservative: a model token must contain a letter and a
 * digit, or be a three-plus digit identifier, and generic spec tokens are
 * ignored. This is supplemental identity evidence, never a title-only match.
 */
export function extractModelTokens(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      normalizedTokens(value).filter(token => {
        if (GENERIC_MODEL_TOKENS.has(token)) return false;
        const hasLetter = /[a-z]/.test(token);
        const hasDigit = /\d/.test(token);
        return (
          (hasLetter && hasDigit && token.length >= 2) ||
          (!hasLetter && token.length >= 3)
        );
      })
    )
  );
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  a.forEach(token => {
    if (b.has(token)) intersection++;
  });
  return intersection / (a.size + b.size - intersection);
}

export function assessProductMatch(
  merchant: {
    title: string;
    sku?: string | null;
    barcode?: string | null;
    vendor?: string | null;
  },
  extracted: DeterministicProductData
): ProductMatchAssessment {
  const titleSimilarity = jaccard(
    normalizedTokens(merchant.title),
    normalizedTokens(extracted.title)
  );
  const skuExact = equalIdentifier(merchant.sku, extracted.sku);
  const barcodeExact = equalIdentifier(merchant.barcode, extracted.barcode);
  const skuMatchConfidence = skuExact || barcodeExact ? 1 : 0;
  const merchantModelTokens = extractModelTokens(merchant.title);
  const extractedModelTokens = extractModelTokens(
    [
      extracted.title,
      extracted.productIdentity.canonicalUrl,
      extracted.productIdentity.mpn,
      extracted.productIdentity.sku,
    ]
      .filter(Boolean)
      .join(" ")
  );
  const modelExact = merchantModelTokens.some(token =>
    extractedModelTokens.some(
      extractedToken =>
        extractedToken === token ||
        (token.length >= 4 &&
          (extractedToken.includes(token) || token.includes(extractedToken)))
    )
  );
  const merchantVariants = normalizedTokens(merchant.title).filter(token =>
    /\d/.test(token)
  );
  const extractedIdentityText = [
    extracted.title,
    extracted.productIdentity.canonicalUrl,
    extracted.productIdentity.mpn,
    extracted.productIdentity.sku,
  ]
    .filter(Boolean)
    .join(" ");
  const extractedVariants = new Set(
    normalizedTokens(extractedIdentityText).filter(token => /\d/.test(token))
  );
  const variantSimilarity =
    merchantVariants.length === 0
      ? 1
      : merchantVariants.filter(token =>
          Array.from(extractedVariants).some(
            extractedToken =>
              extractedToken === token ||
              (token.length >= 3 &&
                (extractedToken.includes(token) ||
                  token.includes(extractedToken)))
          )
        ).length / merchantVariants.length;
  const vendorTokens = normalizedTokens(merchant.vendor);
  const extractedVendorTokens = normalizedTokens(extracted.vendor);
  const vendorEvidenceMatches =
    vendorTokens.length === 0 ||
    extractedVendorTokens.length === 0 ||
    vendorTokens.some(token => extractedVendorTokens.includes(token));
  const vendorInTitle =
    vendorTokens.length > 0 &&
    vendorTokens.every(token =>
      normalizedTokens(extracted.title).includes(token)
    );
  const vendorInIdentity =
    vendorTokens.length > 0 &&
    vendorTokens.every(token =>
      normalizedTokens(extracted.productIdentity.canonicalUrl).includes(token)
    );
  const vendorMatches = vendorEvidenceMatches || vendorInTitle;
  const vendorConfirmed =
    vendorTokens.length === 0 ||
    (extractedVendorTokens.length > 0 &&
      vendorTokens.some(token => extractedVendorTokens.includes(token))) ||
    vendorInTitle ||
    vendorInIdentity;
  const identityStrong =
    skuExact ||
    barcodeExact ||
    titleSimilarity >= 0.82 ||
    (modelExact && vendorConfirmed);
  const completePrice =
    extracted.price != null &&
    extracted.price > 0 &&
    Boolean(extracted.currency);
  const authorityStrong =
    extracted.source === "shopify-json" ||
    extracted.source === "json-ld" ||
    extracted.source === "embedded-json";
  const agreementOrIdentifier =
    extracted.independentPriceSources > 1 ||
    skuExact ||
    barcodeExact ||
    (authorityStrong && titleSimilarity >= 0.92);
  const highConfidence = Boolean(
    extracted.structured &&
      extracted.resolution.state === "confident" &&
      completePrice &&
      identityStrong &&
      variantSimilarity === 1 &&
      vendorMatches &&
      !extracted.variantAmbiguous &&
      extracted.evidenceScore >= 0.78 &&
      agreementOrIdentifier
  );
  const matchConfidence = Math.max(
    titleSimilarity,
    skuMatchConfidence,
    modelExact && vendorMatches ? 0.93 : 0
  );
  const deterministicMatch = Boolean(
    identityStrong &&
      modelExact &&
      vendorConfirmed &&
      completePrice &&
      !extracted.variantAmbiguous &&
      (!extracted.priceConflict || extracted.priceConflictResolved) &&
      extracted.priceEvidence.length > 0 &&
      !extracted.resolution.failureReasons.some(reason =>
        [
          "missing_price",
          "missing_currency",
          "variant_ambiguity",
          "product_conflict",
          "price_conflict",
        ].includes(reason)
      )
  );
  const confidence = highConfidence
    ? Math.max(0.92, Math.min(0.99, extracted.evidenceScore + 0.15))
    : Math.min(
        0.84,
        Math.max(0, extracted.evidenceScore * 0.75 + matchConfidence * 0.25)
      );
  const failureReasons = new Set(extracted.resolution.failureReasons);
  if (!identityStrong) failureReasons.add("missing_product_identity");
  if (variantSimilarity !== 1) failureReasons.add("variant_ambiguity");
  if (!vendorMatches) failureReasons.add("product_conflict");
  if (!highConfidence) failureReasons.add("low_confidence");
  const breakdown: ScoreContribution[] = [
    ...extracted.resolution.breakdown,
    {
      signal: "exact_product_identifier",
      points: skuExact || barcodeExact ? 30 : 0,
      reason: skuExact
        ? "merchant and page SKU match exactly"
        : barcodeExact
          ? "merchant and page barcode match exactly"
          : "no exact SKU or barcode confirmation",
    },
    {
      signal: "title_similarity",
      points: titleSimilarity * 20,
      reason: `product title similarity is ${titleSimilarity.toFixed(3)}`,
    },
    {
      signal: "model_identifier_match",
      points: modelExact ? 25 : 0,
      reason: modelExact
        ? "a model identifier in the merchant title appears on the page"
        : "no exact model identifier confirmation",
    },
    {
      signal: "variant_match",
      points: variantSimilarity === 1 ? 10 : -20,
      reason:
        variantSimilarity === 1
          ? "requested variant tokens agree"
          : "requested variant tokens conflict",
    },
    {
      signal: "vendor_match",
      points: vendorMatches ? 5 : -15,
      reason: vendorMatches
        ? "vendor evidence does not conflict"
        : "vendor evidence conflicts with the merchant product",
    },
  ];
  return {
    isMatch: identityStrong && variantSimilarity === 1 && vendorMatches,
    confidence,
    matchConfidence,
    skuMatchConfidence,
    titleSimilarity,
    variantSimilarity,
    highConfidence,
    modelExact,
    vendorMatches,
    deterministicMatch,
    resolution: {
      state: highConfidence
        ? "confident"
        : completePrice && identityStrong
          ? "ambiguous"
          : "unresolved",
      confidence,
      score: confidence * 100,
      breakdown,
      failureReasons: Array.from(failureReasons),
    },
  };
}

export function contentHash(content: string): string {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function reduceProductContent(
  content: string,
  maxChars: number,
  evidence?: DeterministicProductData | null
): string {
  const sections: string[] = [];
  if (evidence)
    sections.push(
      `DETERMINISTIC EVIDENCE\n${JSON.stringify({ extractorVersion: evidence.extractorVersion, identity: evidence.productIdentity, price: evidence.price, currency: evidence.currency, salePrice: evidence.salePrice, originalPrice: evidence.originalPrice, variantAmbiguous: evidence.variantAmbiguous, priceConflict: evidence.priceConflict, resolution: evidence.resolution, productEvidence: evidence.productEvidence.slice(0, 20), variantEvidence: evidence.variantEvidence.slice(0, 20), priceEvidence: evidence.priceEvidence.slice(0, 30) })}`
    );
  Array.from(
    content.matchAll(
      /<script\b[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>[\s\S]*?<\/script>/gi
    )
  ).forEach(match => sections.push(match[0].slice(0, 3500)));
  const meta = content.match(
    /<meta\b[^>]*(?:product:|og:|price|currency|availability|sku|gtin)[^>]*>/gi
  );
  if (meta) sections.push(meta.slice(0, 30).join("\n"));
  const lines = content
    .replace(
      /<script\b(?![^>]*type=["']application\/(?:ld\+)?json)[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  const relevant =
    /(?:^#{1,3}\s|price|sale|was|now|compare|currency|availability|in stock|out of stock|shipping|subscription|installment|sku|barcode|gtin|model|variant|product|[$€£¥]\s?\d|\b\d[\d.,]*\s?(?:USD|EUR|GBP|CAD|AUD|MAD|JPY|CHF)\b)/i;
  const selected = lines.filter(line => relevant.test(line));
  const fallback = lines.slice(0, 40);
  return Array.from(
    new Set([...sections, ...(selected.length ? selected : fallback)])
  )
    .join("\n")
    .slice(0, maxChars);
}

const inFlightExtractions = new Map<string, Promise<unknown>>();

export function deduplicateExtraction<T>(
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const existing = inFlightExtractions.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = work().finally(() => inFlightExtractions.delete(key));
  inFlightExtractions.set(key, promise);
  return promise;
}
