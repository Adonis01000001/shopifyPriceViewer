export interface PriceNormalizationInput {
  price: string | null | undefined;
  currency: string | null | undefined;
  quantity?: number | null;
}

export interface NormalizedPrice {
  price: string | null;
  currency: string | null;
  method: string | null;
}

const DEFAULT_BASE_CURRENCY = "USD";

function parsePositiveNumber(value: string | number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPrice(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function configuredBaseCurrency(): string {
  return (process.env.PRICE_RADAR_BASE_CURRENCY ?? DEFAULT_BASE_CURRENCY)
    .trim()
    .toUpperCase()
    .slice(0, 3);
}

function configuredRates(): Record<string, number> {
  const raw = process.env.PRICE_RADAR_FX_RATES;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const rate = parsePositiveNumber(value as number);
        return rate ? [[key.trim().toUpperCase(), rate]] : [];
      })
    );
  } catch {
    return {};
  }
}

export function extractOfferQuantity(value: string | null | undefined): {
  quantity: number;
  unit: string;
} {
  const text = (value ?? "").toLowerCase();
  const multiplier = text.match(/\b(\d+(?:\.\d+)?)\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:ml|l|g|kg|oz|lb)\b/);
  if (multiplier) {
    return { quantity: parsePositiveNumber(multiplier[1]) ?? 1, unit: "each" };
  }
  const match =
    text.match(/\b(?:pack|pk|set|bundle|count|ct|x)\s*[:-]?\s*(\d+(?:\.\d+)?)\s*(pcs?|pieces?|units?|count)?\b/) ??
    text.match(/\b(\d+(?:\.\d+)?)\s*(?:pack|packs|pcs?|pieces?|units?|count)\b/);
  if (!match) return { quantity: 1, unit: "each" };
  const quantity = parsePositiveNumber(match[1]) ?? 1;
  return { quantity, unit: (match[2] ?? "each").toLowerCase() };
}

export function normalizeComparablePrice(
  input: PriceNormalizationInput
): NormalizedPrice {
  const price = parsePositiveNumber(input.price);
  const sourceCurrency = input.currency?.trim().toUpperCase();
  const quantity = parsePositiveNumber(input.quantity) ?? 1;
  if (!price || !sourceCurrency || sourceCurrency.length !== 3) {
    return { price: null, currency: null, method: null };
  }

  const baseCurrency = configuredBaseCurrency();
  const perUnitPrice = price / quantity;
  if (sourceCurrency === baseCurrency) {
    return {
      price: formatPrice(perUnitPrice),
      currency: baseCurrency,
      method: quantity === 1 ? "same-currency" : "same-currency-per-unit",
    };
  }

  const rates = configuredRates();
  const directRate = rates[`${sourceCurrency}:${baseCurrency}`] ??
    rates[`${sourceCurrency}_${baseCurrency}`];
  if (!directRate) {
    return { price: null, currency: null, method: "unavailable-fx-rate" };
  }
  return {
    price: formatPrice(perUnitPrice * directRate),
    currency: baseCurrency,
    method: quantity === 1 ? "configured-fx" : "configured-fx-per-unit",
  };
}
