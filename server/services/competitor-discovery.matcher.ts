export type DiscoveryMatchType = "exact" | "equivalent";

export interface DiscoveryProductIdentity {
  title: string;
  brand?: string | null;
  manufacturer?: string | null;
  sku?: string | null;
  barcode?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  modelNumber?: string | null;
  category?: string | null;
  productType?: string | null;
  description?: string | null;
  attributes?: Record<string, string> | null;
  tags?: string[] | null;
  condition?: string | null;
  variant?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

export interface DiscoveryOfferIdentity extends DiscoveryProductIdentity {
  productUrl: string;
  price: string | null;
  currency: string | null;
  availability?: string | null;
}

export interface DiscoveryMatchDecision {
  accepted: boolean;
  score: number;
  matchType: DiscoveryMatchType | null;
  method: string;
  reason: string | null;
}

const GENERIC_TOKENS = new Set([
  "A",
  "AN",
  "AND",
  "BUY",
  "CM",
  "FOR",
  "HD",
  "INCH",
  "INCHES",
  "LED",
  "NEW",
  "PRICE",
  "READY",
  "SALE",
  "SHOP",
  "SMART",
  "THE",
  "TV",
  "WITH",
]);

const ACCESSORY_TOKENS = new Set([
  "ADAPTER",
  "BATTERY",
  "CABLE",
  "CASE",
  "CHARGER",
  "COVER",
  "MOUNT",
  "PROTECTOR",
  "REPLACEMENT",
  "REMOTE",
  "SPARE",
  "STAND",
]);

const BUNDLE_TOKENS = new Set([
  "BUNDLE",
  "BUNDLES",
  "COMBO",
  "COMBOS",
  "KIT",
  "KITS",
  "MULTIPACK",
  "MULTI-PACK",
  "PACK",
  "SET",
]);

const VARIANT_TOKENS = new Set([
  "AIR",
  "CLASSIC",
  "EDITION",
  "LITE",
  "MAX",
  "MINI",
  "PLUS",
  "PRO",
  "SE",
  "STANDARD",
  "ULTRA",
  "XL",
  "XXL",
]);

const COLOR_TOKENS = new Set([
  "BLACK",
  "BLUE",
  "BROWN",
  "GOLD",
  "GRAY",
  "GREY",
  "GREEN",
  "PINK",
  "PURPLE",
  "RED",
  "SILVER",
  "WHITE",
  "YELLOW",
]);

const IDENTIFIER_FIELDS = [
  ["gtin", "gtin"],
  ["barcode", "barcode"],
  ["mpn", "mpn"],
  ["modelNumber", "model"],
  ["sku", "sku"],
] as const;

function normalizedText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function normalizeIdentifier(value: string | null | undefined): string {
  return normalizedText(value).replace(/[^A-Z0-9]/g, "");
}

function identifierTokens(value: string | null | undefined): string[] {
  const text = normalizedText(value);
  return Array.from(text.matchAll(/\b[A-Z0-9][A-Z0-9-]{3,}\b/g))
    .map(match => normalizeIdentifier(match[0]))
    .filter(token => token.length >= 4 && !GENERIC_TOKENS.has(token));
}

function identifierEntries(
  product: DiscoveryProductIdentity
): Array<{ kind: string; value: string }> {
  return IDENTIFIER_FIELDS.flatMap(([field, kind]) => {
    const value = product[field];
    const normalized = normalizeIdentifier(value);
    return normalized ? [{ kind, value: normalized }] : [];
  });
}

function modelLikeIdentifiers(product: DiscoveryProductIdentity & { productUrl?: string }): Set<string> {
  const values = [product.title, product.productUrl];
  return new Set(
    values
      .flatMap(value => identifierTokens(value))
      .filter(token => /[A-Z]/.test(token) && /\d/.test(token) && token.length >= 5)
  );
}

function titleTokens(value: string | null | undefined): Set<string> {
  return new Set(
    normalizedText(value)
      .replace(/[^A-Z0-9]+/g, " ")
      .split(/\s+/)
      .filter(token => token.length >= 2 && !GENERIC_TOKENS.has(token))
  );
}

function identityText(product: DiscoveryProductIdentity): string {
  const attributes = Object.entries(product.attributes ?? {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" ");
  return [
    product.title,
    product.description,
    product.productType,
    product.variant,
    attributes,
    ...(product.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function extractDimensionSignals(product: DiscoveryProductIdentity): Map<string, number[]> {
  const text = identityText(product);
  const signals = new Map<string, number[]>();
  const add = (key: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    signals.set(key, [...(signals.get(key) ?? []), value]);
  };

  for (const match of Array.from(text.matchAll(/\b(\d+(?:\.\d+)?)\s*(GB|TB|MB|ML|L|KG|G|CM|MM|INCH(?:ES)?|")(?![A-Z0-9])/gi))) {
    const value = Number(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === '"' || unit.startsWith("INCH")) add("screen", value);
    else if (unit === "CM") add("length-cm", value);
    else if (unit === "MM") add("length-cm", value / 10);
    else if (unit === "TB") add("storage-gb", value * 1024);
    else if (unit === "GB") add("storage-gb", value);
    else if (unit === "MB") add("storage-gb", value / 1024);
    else if (unit === "L") add("volume-ml", value * 1000);
    else if (unit === "ML") add("volume-ml", value);
    else if (unit === "KG") add("weight-g", value * 1000);
    else if (unit === "G") add("weight-g", value);
  }
  // 80 cm is the common retail representation of a 32-inch screen.
  const lengths = signals.get("length-cm") ?? [];
  if (lengths.length > 0) signals.set("screen", [...(signals.get("screen") ?? []), ...lengths.map(value => value / 2.54)]);
  return signals;
}

function approximatelyEqual(left: number, right: number, relativeTolerance = 0.08): boolean {
  return Math.abs(left - right) <= Math.max(left, right, 1) * relativeTolerance;
}

function extractDescriptorTokens(product: DiscoveryProductIdentity): {
  colors: Set<string>;
  variants: Set<string>;
} {
  const tokens = titleTokens(identityText(product));
  return {
    colors: new Set(Array.from(tokens).filter(token => COLOR_TOKENS.has(token))),
    variants: new Set(Array.from(tokens).filter(token => VARIANT_TOKENS.has(token))),
  };
}

function hasSpecificationMismatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): { kind: string; reason: string } | null {
  const merchantDimensions = extractDimensionSignals(merchant);
  const offerDimensions = extractDimensionSignals(offer);
  for (const [key, merchantValues] of Array.from(merchantDimensions.entries())) {
    const offerValues = offerDimensions.get(key);
    if (!offerValues) continue;
    if (!merchantValues.some((left: number) => offerValues.some((right: number) => approximatelyEqual(left, right)))) {
      return { kind: key, reason: `The ${key.replace(/-/g, " ")} specification conflicts` };
    }
  }

  const merchantDescriptors = extractDescriptorTokens(merchant);
  const offerDescriptors = extractDescriptorTokens(offer);
  if (
    merchantDescriptors.colors.size > 0 &&
    offerDescriptors.colors.size > 0 &&
    !Array.from(merchantDescriptors.colors).some(color => offerDescriptors.colors.has(color))
  ) {
    return { kind: "color", reason: "The product color/finish conflicts" };
  }
  if (
    merchantDescriptors.variants.size > 0 &&
    offerDescriptors.variants.size > 0 &&
    !Array.from(merchantDescriptors.variants).some(variant => offerDescriptors.variants.has(variant))
  ) {
    return { kind: "variant", reason: "The product edition or variant conflicts" };
  }
  return null;
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let matched = 0;
  for (const token of Array.from(left)) if (right.has(token)) matched++;
  return matched / Math.min(left.size, right.size);
}

function sameBrand(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): boolean {
  const merchantBrand = normalizeIdentifier(merchant.brand ?? merchant.manufacturer);
  const offerBrand = normalizeIdentifier(offer.brand ?? offer.manufacturer);
  if (!merchantBrand) return true;
  if (offerBrand) return merchantBrand === offerBrand;
  return titleTokens(offer.title).has(merchantBrand);
}

function hasAccessoryMismatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): boolean {
  const merchantTokens = titleTokens(merchant.title);
  return Array.from(titleTokens(offer.title)).some(
    token => ACCESSORY_TOKENS.has(token) && !merchantTokens.has(token)
  );
}

function hasConditionMismatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): boolean {
  const condition = normalizedText(offer.condition);
  const title = normalizedText(offer.title);
  const used = /USED|REFURBISHED|REFURB|PREOWNED|OPENBOX|OPEN BOX/.test(
    `${condition} ${title}`
  );
  if (!used) return false;
  return !/USED|REFURBISHED|REFURB|PREOWNED|OPENBOX|OPEN BOX/.test(
    normalizedText(merchant.condition)
  );
}

function hasQuantityMismatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): boolean {
  if (merchant.quantity == null || offer.quantity == null) return false;
  const merchantUnit = normalizedText(merchant.unit);
  const offerUnit = normalizedText(offer.unit);
  return merchant.quantity !== offer.quantity || Boolean(merchantUnit && offerUnit && merchantUnit !== offerUnit);
}

function hasBundleMismatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): boolean {
  const merchantTokens = titleTokens(identityText(merchant));
  return Array.from(titleTokens(identityText(offer))).some(
    token => BUNDLE_TOKENS.has(token) && !merchantTokens.has(token)
  );
}

export function buildDiscoveryQueries(product: DiscoveryProductIdentity): string[] {
  const queries: string[] = [];
  const title = product.title.trim();
  const brand = (product.brand ?? product.manufacturer)?.trim();
  const identifiers = [
    product.gtin,
    product.mpn,
    product.modelNumber,
    product.sku,
    product.barcode,
    ...Array.from(modelLikeIdentifiers(product)),
  ]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const identifier of identifiers) {
    queries.push(`"${identifier}" price`);
    if (brand) queries.push(`"${brand}" "${identifier}"`);
  }
  if (title) {
    queries.push(`"${title}" price`);
    queries.push(`${title} buy`);
  }
  if (brand && title) queries.push(`${brand} ${title} price`);
  const shortTitle = title.split(/\s+/).slice(0, 6).join(" ");
  if (shortTitle && shortTitle !== title) queries.push(`${shortTitle} retailer`);

  return Array.from(new Set(queries.map(query => query.trim()).filter(Boolean)));
}

export function decideDiscoveryMatch(
  merchant: DiscoveryProductIdentity,
  offer: DiscoveryOfferIdentity
): DiscoveryMatchDecision {
  if (!offer.price || Number(offer.price) <= 0) {
    return { accepted: false, score: 0, matchType: null, method: "rejected-no-price", reason: "No verified current price was extracted" };
  }
  if (!offer.currency) {
    return { accepted: false, score: 0, matchType: null, method: "rejected-no-currency", reason: "The price currency could not be verified" };
  }
  if (offer.availability === "out_of_stock") {
    return { accepted: false, score: 0, matchType: null, method: "rejected-out-of-stock", reason: "The listing is not currently in stock" };
  }
  if (!sameBrand(merchant, offer)) {
    return { accepted: false, score: 0, matchType: null, method: "rejected-brand-mismatch", reason: "Brand does not match the merchant product" };
  }
  if (hasAccessoryMismatch(merchant, offer)) {
    return { accepted: false, score: 0.05, matchType: null, method: "rejected-accessory", reason: "The listing appears to be an accessory or replacement part" };
  }
  if (hasConditionMismatch(merchant, offer)) {
    return { accepted: false, score: 0.05, matchType: null, method: "rejected-condition", reason: "Used or refurbished condition is outside the merchant product scope" };
  }
  if (hasQuantityMismatch(merchant, offer)) {
    return { accepted: false, score: 0.1, matchType: null, method: "rejected-quantity", reason: "The listing quantity or unit differs from the merchant product" };
  }
  if (hasBundleMismatch(merchant, offer)) {
    return { accepted: false, score: 0.08, matchType: null, method: "rejected-bundle", reason: "The listing is a bundle, kit, set, or multipack that is not equivalent to the merchant product" };
  }
  const specificationMismatch = hasSpecificationMismatch(merchant, offer);
  if (specificationMismatch) {
    return { accepted: false, score: 0.08, matchType: null, method: `rejected-${specificationMismatch.kind}`, reason: specificationMismatch.reason };
  }

  const merchantIdentifiers = identifierEntries(merchant);
  const offerIdentifiers = identifierEntries(offer);
  const offerByKind = new Map(offerIdentifiers.map(entry => [entry.kind, entry.value]));
  for (const merchantEntry of merchantIdentifiers) {
    const offerValue = offerByKind.get(merchantEntry.kind);
    if (offerValue && offerValue !== merchantEntry.value) {
      return { accepted: false, score: 0.1, matchType: null, method: "rejected-identifier-mismatch", reason: `The ${merchantEntry.kind} identifiers conflict` };
    }
  }
  const exactEntry = merchantIdentifiers.find(entry =>
    offerIdentifiers.some(candidate => candidate.kind === entry.kind && candidate.value === entry.value)
  );
  if (exactEntry) {
    const method = `exact-${exactEntry.kind}`;
    return { accepted: true, score: 0.99, matchType: "exact", method, reason: null };
  }

  const merchantModels = modelLikeIdentifiers(merchant);
  const offerModels = modelLikeIdentifiers(offer);
  const modelMatch = Array.from(merchantModels).find(model => offerModels.has(model));
  if (modelMatch) {
    return { accepted: true, score: 0.97, matchType: "exact", method: "exact-model-in-title", reason: null };
  }
  if (merchantModels.size > 0 && offerModels.size > 0) {
    return { accepted: false, score: 0.1, matchType: null, method: "rejected-model-mismatch", reason: "The model identifiers embedded in the product evidence conflict" };
  }
  if (merchantIdentifiers.length > 0 && offerIdentifiers.length > 0) {
    return { accepted: false, score: 0.1, matchType: null, method: "rejected-identifier-mismatch", reason: "The available product identifiers conflict" };
  }

  const merchantTitle = titleTokens(merchant.title);
  const offerTitle = titleTokens(offer.title);
  const titleOverlap = overlap(merchantTitle, offerTitle);
  const categoryMatch =
    merchant.category && offer.category
      ? normalizeIdentifier(merchant.category) === normalizeIdentifier(offer.category)
      : false;
  const brandSignal = merchant.brand || merchant.manufacturer ? 0.3 : 0.15;
  const score = Math.min(0.94, brandSignal + titleOverlap * 0.55 + (categoryMatch ? 0.15 : 0));
  const distinctiveMatches = Array.from(merchantTitle).filter(
    token => offerTitle.has(token) && !/^\d+$/.test(token) && token.length >= 4
  ).length;
  const accepted =
    score >= 0.85 &&
    distinctiveMatches >= 3 &&
    (merchant.brand != null || merchant.manufacturer != null) &&
    merchantTitle.size >= 3 &&
    offerTitle.size >= 3;

  return {
    accepted,
    score: Math.round(score * 100) / 100,
    matchType: accepted ? "equivalent" : null,
    method: accepted ? "brand-title-specification" : "rejected-low-confidence",
    reason: accepted ? null : "The listing did not provide enough matching product evidence",
  };
}
