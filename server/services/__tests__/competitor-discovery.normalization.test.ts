import { describe, expect, it, afterEach } from "vitest";
import {
  extractOfferQuantity,
  normalizeComparablePrice,
} from "../competitor-discovery.normalization";

const originalBase = process.env.PRICE_RADAR_BASE_CURRENCY;
const originalRates = process.env.PRICE_RADAR_FX_RATES;

afterEach(() => {
  if (originalBase === undefined) delete process.env.PRICE_RADAR_BASE_CURRENCY;
  else process.env.PRICE_RADAR_BASE_CURRENCY = originalBase;
  if (originalRates === undefined) delete process.env.PRICE_RADAR_FX_RATES;
  else process.env.PRICE_RADAR_FX_RATES = originalRates;
});

describe("competitor discovery price normalization", () => {
  it("normalizes same-currency packs to a per-unit comparison price", () => {
    expect(extractOfferQuantity("USB cable pack 5 pieces")).toEqual({
      quantity: 5,
      unit: "pieces",
    });
    expect(
      normalizeComparablePrice({ price: "50.00", currency: "USD", quantity: 5 })
    ).toEqual({
      price: "10",
      currency: "USD",
      method: "same-currency-per-unit",
    });
  });

  it("uses an explicitly configured exchange rate and never guesses one", () => {
    process.env.PRICE_RADAR_BASE_CURRENCY = "USD";
    process.env.PRICE_RADAR_FX_RATES = JSON.stringify({ "EUR:USD": 1.1 });
    expect(normalizeComparablePrice({ price: "10", currency: "EUR" })).toEqual({
      price: "11",
      currency: "USD",
      method: "configured-fx",
    });

    delete process.env.PRICE_RADAR_FX_RATES;
    expect(normalizeComparablePrice({ price: "10", currency: "EUR" })).toEqual({
      price: null,
      currency: null,
      method: "unavailable-fx-rate",
    });
  });

  it("normalizes multiplier packs by item count instead of treating the fill size as the pack count", () => {
    expect(extractOfferQuantity("water 2 x 500 ml bottles")).toEqual({
      quantity: 2,
      unit: "each",
    });
  });
});
