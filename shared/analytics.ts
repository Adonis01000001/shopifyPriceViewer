export const PRODUCT_ANALYTICS_EVENTS = [
  "signup_completed",
  "trial_started",
  "onboarding_step_started",
  "onboarding_step_completed",
  "first_value_reached",
  "dashboard_viewed",
  "feature_activated",
  "feature_upgrade_prompt_viewed",
  "plan_selected",
  "checkout_started",
  "checkout_completed",
  "subscription_cancelled",
] as const;

export type ProductAnalyticsEventName = (typeof PRODUCT_ANALYTICS_EVENTS)[number];
export type AnalyticsPropertyValue = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;
