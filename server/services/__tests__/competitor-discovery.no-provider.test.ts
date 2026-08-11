import { afterEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";

vi.mock("../../_core/env", () => ({
  ENV: {
    serpApiKey: "",
    firecrawlApiKey: "",
    exaApiKey: "",
    firecrawlBaseUrl: undefined,
  },
}));

import { competitorDiscoveryService } from "../competitor-discovery.service";
import { requireDb } from "../../_core/db-assert";
import { cronRuns, products, users } from "../../../drizzle/schema";

describe("competitor discovery without providers", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    const database = await requireDb();
    for (const userId of createdUserIds.splice(0)) {
      await database.delete(users).where(eq(users.id, userId));
    }
  });

  it("records a partial run with explicit missing-provider failures", async () => {
    const database = await requireDb();
    const [user] = await database
      .insert(users)
      .values({
        email: `discovery-no-provider-${Date.now()}@example.com`,
        name: "No Provider Test",
        passwordHash: "test",
        role: "user",
      })
      .returning({ id: users.id });
    createdUserIds.push(user.id);
    const [product] = await database
      .insert(products)
      .values({ userId: user.id, title: "No provider product", price: "10.00" })
      .returning({ id: products.id });

    const result = await competitorDiscoveryService.discoverForProduct(user.id, product.id);
    expect(result.validCompetitors).toBe(0);
    const [run] = await database
      .select()
      .from(cronRuns)
      .where(
        and(
          eq(cronRuns.jobType, "competitor_discovery"),
          eq(cronRuns.status, "partial"),
          sql`${cronRuns.metadata}->>'userId' = ${user.id}`,
          sql`${cronRuns.metadata}->>'productId' = ${product.id}`
        )
      )
      .orderBy(desc(cronRuns.startedAt))
      .limit(1);
    expect(run?.errorsCount).toBeGreaterThanOrEqual(1);
    expect(run?.errorDetails).toMatchObject({
      providerFailures: expect.arrayContaining([
        expect.objectContaining({ provider: "exa", error: "provider-not-configured" }),
      ]),
    });
  });
});
