import { eq } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { users } from "../../drizzle/schema";
import {
  DEFAULT_PRICING_RULES,
  rulesFromPercents,
  type PricingRules,
} from "./pricing-engine.service";

/**
 * The two numbers a merchant can change about how a price is worked out.
 * They live on the user row; this is the one place that reads them, so a
 * suggestion shown on screen and one written by the nightly run cannot
 * disagree about which rules were in force.
 */
export const pricingRulesService = {
  async forUser(userId: string): Promise<PricingRules> {
    const database = await requireDb();
    const row = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { undercutPercent: true, minMarginPercent: true },
    });
    if (!row) return DEFAULT_PRICING_RULES;
    return rulesFromPercents(row);
  },

  /** The same rules as the merchant set them, for showing back on screen. */
  async percentsForUser(
    userId: string
  ): Promise<{ undercutPercent: number; minMarginPercent: number }> {
    const database = await requireDb();
    const row = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { undercutPercent: true, minMarginPercent: true },
    });
    return {
      undercutPercent: Number(row?.undercutPercent ?? 5),
      minMarginPercent: Number(row?.minMarginPercent ?? 10),
    };
  },
};
