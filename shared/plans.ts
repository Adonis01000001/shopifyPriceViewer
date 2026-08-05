export type PlanId = "free" | "starter" | "pro" | "scale";
export type FeatureKey =
  | "emailAlerts"
  | "advancedAnalytics"
  | "aiRecommendations"
  | "priceRadar"
  | "dailyReports"
  | "teamAccess"
  | "anomalyDetection";

export type UsageKey =
  | "products"
  | "competitors"
  | "radarSources"
  | "monthlyChanges"
  | "alertsMonthly"
  | "aiRunsMonthly";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  description: string;
  limits: {
    products: number | null;
    competitors: number | null;
    radarSources: number | null;
    monthlyChanges: number | null;
    alertsMonthly: number | null;
    aiRunsMonthly: number | null;
  };
  entitlements: Readonly<Record<FeatureKey, boolean>>;
  features: readonly string[];
};

const noPremiumFeatures: Readonly<Record<FeatureKey, boolean>> = {
  emailAlerts: false,
  advancedAnalytics: false,
  aiRecommendations: false,
  priceRadar: false,
  dailyReports: false,
  teamAccess: false,
  anomalyDetection: false,
};

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    description: "A focused starting point for small catalogs.",
    limits: {
      products: 25,
      competitors: 2,
      radarSources: 1,
      monthlyChanges: 100,
      alertsMonthly: 25,
      aiRunsMonthly: 0,
    },
    entitlements: noPremiumFeatures,
    features: [
      "Core price monitoring",
      "In-app alerts",
      "Basic recommendations",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    description: "For merchants actively optimizing a growing store.",
    limits: {
      products: 250,
      competitors: 10,
      radarSources: 5,
      monthlyChanges: 1_000,
      alertsMonthly: 250,
      aiRunsMonthly: 0,
    },
    entitlements: { ...noPremiumFeatures, emailAlerts: true },
    features: [
      "Historical trends",
      "Email alert preferences",
      "AI recommendations",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "For teams managing a serious competitive pricing program.",
    limits: {
      products: 2_000,
      competitors: 50,
      radarSources: 25,
      monthlyChanges: 10_000,
      alertsMonthly: 2_500,
      aiRunsMonthly: 100,
    },
    entitlements: {
      ...noPremiumFeatures,
      emailAlerts: true,
      advancedAnalytics: true,
      aiRecommendations: true,
      priceRadar: true,
      dailyReports: true,
      anomalyDetection: true,
    },
    features: [
      "Advanced market intelligence",
      "Price Radar",
      "Priority monitoring",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    description: "For high-volume catalogs and multi-person operations.",
    limits: {
      products: null,
      competitors: null,
      radarSources: null,
      monthlyChanges: null,
      alertsMonthly: null,
      aiRunsMonthly: null,
    },
    entitlements: {
      emailAlerts: true,
      advancedAnalytics: true,
      aiRecommendations: true,
      priceRadar: true,
      dailyReports: true,
      teamAccess: true,
      anomalyDetection: true,
    },
    features: ["Custom limits", "Team access", "Dedicated support"],
  },
};

export function getPlanDefinition(planId: PlanId): PlanDefinition {
  return PLAN_CATALOG[planId] ?? PLAN_CATALOG.free;
}
