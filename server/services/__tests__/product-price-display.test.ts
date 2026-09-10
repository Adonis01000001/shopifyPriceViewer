import { describe, expect, it } from "vitest";
import { formatPrice } from "../../../client/src/lib/price";
import { priceSchema } from "../../../shared/validation";

describe("product price contract", () => {
  it("preserves decimal product prices and currency in the dashboard", () => {
    expect(formatPrice("99.99")).toBe("$99.99");
    expect(formatPrice("150.50", "EUR")).toBe("€150.50");
  });

  it.each([null, undefined, "", "not-a-price", "0", 0])(
    "uses the unset fallback for %p",
    value => {
      expect(formatPrice(value as string | number | null | undefined)).toBe(
        "Price not set"
      );
    }
  );

  it("rejects zero as a product price", () => {
    expect(priceSchema.safeParse("0").success).toBe(false);
    expect(priceSchema.safeParse("99.99").success).toBe(true);
  });
});
