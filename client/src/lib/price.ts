/**
 * Format a persisted product price consistently across the dashboard.
 * PostgreSQL decimal columns are returned by Drizzle as strings; accepting
 * numbers as well keeps this safe for calculated/API-backed values.
 */
export function formatPrice(
  value: string | number | null | undefined,
  currency = "USD"
): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Price not set";
  }

  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Price not set";

  const safeCurrency = /^[A-Za-z]{3}$/.test(currency)
    ? currency.toUpperCase()
    : "USD";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
