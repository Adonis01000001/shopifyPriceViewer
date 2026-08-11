import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { competitorDiscoveryLocks, products, users } from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";
import {
  acquireDiscoveryLease,
  releaseDiscoveryLease,
} from "../competitor-discovery.service";

describe("competitor discovery product lease", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    const database = await requireDb();
    for (const userId of createdUserIds.splice(0)) {
      await database.delete(users).where(eq(users.id, userId));
    }
  });

  it("allows only one overlapping lease for a tenant product", async () => {
    const database = await requireDb();
    const [user] = await database
      .insert(users)
      .values({
        email: `discovery-lease-${Date.now()}@example.com`,
        name: "Discovery Lease Test",
        passwordHash: "test",
        role: "user",
      })
      .returning({ id: users.id });
    createdUserIds.push(user.id);
    const [product] = await database
      .insert(products)
      .values({ userId: user.id, title: "Lease product", price: "10.00" })
      .returning({ id: products.id });

    const results = await Promise.allSettled([
      acquireDiscoveryLease(database, user.id, product.id),
      acquireDiscoveryLease(database, user.id, product.id),
    ]);
    const fulfilled = results.filter(result => result.status === "fulfilled");
    const rejected = results.filter(result => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: "A competitor discovery run is already active for this product",
    });

    const token = (fulfilled[0] as PromiseFulfilledResult<string>).value;
    await releaseDiscoveryLease(database, user.id, product.id, token);
    const locks = await database
      .select()
      .from(competitorDiscoveryLocks)
      .where(eq(competitorDiscoveryLocks.userId, user.id));
    expect(locks).toHaveLength(0);
  });
});
