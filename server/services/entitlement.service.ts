import { TRPCError } from "@trpc/server";
import type { FeatureKey, UsageKey } from "../../shared/plans";
import { usageService } from "./usage.service";

export const entitlementService = {
  async get(userId: string) {
    const account = await usageService.getAccountUsage(userId);
    return {
      plan: account.plan.id,
      features: account.plan.entitlements,
      usage: account.usage,
      limits: account.limits,
    };
  },

  async assertFeature(userId: string, feature: FeatureKey) {
    const entitlements = await this.get(userId);
    if (!entitlements.features[feature]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `The ${feature} feature is not included in your plan. Upgrade to unlock it.`,
      });
    }
    return entitlements;
  },

  async assertWithinLimit(userId: string, usageKey: UsageKey, amount = 1) {
    const entitlements = await this.get(userId);
    const limit = entitlements.limits[usageKey];
    const current = entitlements.usage[usageKey];
    if (limit !== null && current + amount > limit) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your ${usageKey} limit has been reached. Upgrade your plan to continue.`,
      });
    }
    return entitlements;
  },

  async assertCanAdd(
    userId: string,
    resource: "products" | "competitors" | "radarSources",
    amount = 1
  ) {
    return this.assertWithinLimit(userId, resource, amount);
  },
};
