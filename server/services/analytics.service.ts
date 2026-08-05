import { analyticsEvents } from "../../drizzle/schema";
import type {
  AnalyticsProperties,
  ProductAnalyticsEventName,
} from "../../shared/analytics";
import { requireDb } from "../_core/db-assert";

const MAX_PROPERTY_COUNT = 20;
const MAX_STRING_LENGTH = 250;

function normalizeProperties(properties: AnalyticsProperties): AnalyticsProperties {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => /^[a-zA-Z0-9_]{1,64}$/.test(key))
      .slice(0, MAX_PROPERTY_COUNT)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, MAX_STRING_LENGTH) : value,
      ])
  );
}

export const analyticsService = {
  async track(input: {
    userId: string | null;
    eventName: ProductAnalyticsEventName;
    sessionId?: string;
    properties: AnalyticsProperties;
  }) {
    if (!input.userId) {
      return { accepted: true, eventId: null, skipped: true };
    }
    const database = await requireDb();
    const [event] = await database
      .insert(analyticsEvents)
      .values({
        userId: input.userId,
        eventName: input.eventName,
        sessionId: input.sessionId,
        properties: normalizeProperties(input.properties),
      })
      .returning({ id: analyticsEvents.id });

    return { accepted: true, eventId: event?.id ?? null };
  },
};
