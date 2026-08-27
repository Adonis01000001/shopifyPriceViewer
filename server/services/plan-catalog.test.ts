import { describe, expect, it } from "vitest";
import { getPlanDefinition, PLAN_CATALOG } from "../../shared/plans";

describe("plan catalog", () => {
  it("defines an explicit product tier for every supported plan", () => {
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual([
      "free",
      "pro",
      "scale",
      "starter",
    ]);

    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.name).toBeTruthy();
      expect(plan.features.length).toBeGreaterThan(0);
      expect(Object.keys(plan.entitlements).sort()).toEqual([
        "advancedAnalytics",
        "aiRecommendations",
        "anomalyDetection",
        "dailyReports",
        "emailAlerts",
        "teamAccess",
      ]);
      expect(plan.limits.products === null || plan.limits.products > 0).toBe(
        true
      );
    }
  });

  it("keeps scale unlimited and falls back safely for known IDs", () => {
    expect(getPlanDefinition("scale").limits.products).toBeNull();
    expect(getPlanDefinition("free").id).toBe("free");
    expect(getPlanDefinition("free").entitlements.aiRecommendations).toBe(
      false
    );
    expect(getPlanDefinition("pro").entitlements.aiRecommendations).toBe(true);
    expect(getPlanDefinition("scale").entitlements.teamAccess).toBe(true);
  });
});
