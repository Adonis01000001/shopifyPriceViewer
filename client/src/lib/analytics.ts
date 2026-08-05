import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type {
  AnalyticsProperties,
  ProductAnalyticsEventName,
} from "@shared/analytics";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

let sessionId: string | undefined;

function getSessionId() {
  if (!sessionId && typeof crypto !== "undefined" && crypto.randomUUID) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

/** Pushes a provider-neutral event for an optional GTM/warehouse integration. */
export function pushProductEvent(
  eventName: ProductAnalyticsEventName,
  properties: AnalyticsProperties = {}
) {
  if (typeof window === "undefined") return;
  window.dataLayer ??= [];
  window.dataLayer.push({ event: eventName, ...properties });
}

/** Sends the same event to our first-party analytics endpoint. */
export function useProductAnalytics() {
  const mutation = trpc.analytics.track.useMutation();

  return useCallback(
    (
      eventName: ProductAnalyticsEventName,
      properties: AnalyticsProperties = {}
    ) => {
      pushProductEvent(eventName, properties);
      mutation.mutate({
        eventName,
        sessionId: getSessionId(),
        properties,
      });
    },
    [mutation]
  );
}
