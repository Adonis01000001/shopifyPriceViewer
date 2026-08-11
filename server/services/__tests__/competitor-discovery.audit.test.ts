import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { competitorDiscoveries, products, users } from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";
import { upsertDiscoveryAudit } from "../competitor-discovery.service";

describe("competitor discovery audit retention", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    const database = await requireDb();
    for (const userId of createdUserIds.splice(0)) {
      await database.delete(users).where(eq(users.id, userId));
    }
  });

  it("retains each repeated candidate evaluation as a separate audit attempt", async () => {
    const database = await requireDb();
    const [user] = await database
      .insert(users)
      .values({
        email: `discovery-audit-${Date.now()}@example.com`,
        name: "Discovery Audit Test",
        passwordHash: "test",
        role: "user",
      })
      .returning({ id: users.id });
    createdUserIds.push(user.id);
    const [product] = await database
      .insert(products)
      .values({ userId: user.id, title: "Audit product", price: "10.00" })
      .returning({ id: products.id });
    const candidate = {
      url: "https://shop.example.com/products/audit",
      domain: "shop.example.com",
      title: "Audit product",
      position: 1,
      confidence: 0.9,
    };

    const first = await upsertDiscoveryAudit(database, {
      userId: user.id,
      productId: product.id,
      searchQuery: '"Audit product" price',
      searchEngine: "exa",
      country: "US",
      language: "en",
      candidate,
    });
    const second = await upsertDiscoveryAudit(database, {
      userId: user.id,
      productId: product.id,
      searchQuery: '"Audit product" buy',
      searchEngine: "exa",
      country: "US",
      language: "en",
      candidate,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    const attempts = await database
      .select()
      .from(competitorDiscoveries)
      .where(and(eq(competitorDiscoveries.userId, user.id), eq(competitorDiscoveries.productId, product.id)));
    expect(attempts).toHaveLength(2);
  });
});
