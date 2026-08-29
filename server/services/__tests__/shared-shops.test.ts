import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountCompetitorConnections,
  accountShopConnections,
  competitors,
  shops,
  users,
} from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";
import {
  getAccountShopConnection,
  getOrCreateAccountShopConnection,
  getOrCreateShop,
  normalizeShopDomain,
} from "../shop.service";
import { findOrCreateCompetitor } from "../competitor.service";
import { productService } from "../product.service";

const createdUserIds: string[] = [];
const createdShopDomains: string[] = [];
const createdCompetitorIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const db = await requireDb();
  const [user] = await db
    .insert(users)
    .values({
      email: `shared-shop-${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hashed",
      role: "user",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

function uniqueDomain(prefix: string): string {
  const domain = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.example.test`;
  createdShopDomains.push(domain);
  return domain;
}

afterEach(async () => {
  const db = await requireDb();
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds.splice(0)));
  }
  if (createdCompetitorIds.length > 0) {
    await db
      .delete(competitors)
      .where(inArray(competitors.id, createdCompetitorIds.splice(0)));
  }
  if (createdShopDomains.length > 0) {
    await db
      .delete(shops)
      .where(inArray(shops.normalizedDomain, createdShopDomains.splice(0)));
  }
});

describe("shared canonical shops", () => {
  it("normalizes equivalent URLs to one canonical shop", async () => {
    const domain = uniqueDomain("normalize");
    const first = await getOrCreateShop(`https://www.${domain}/`);
    const second = await getOrCreateShop(`http://${domain}/products/test`);
    const db = await requireDb();
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(eq(shops.normalizedDomain, domain));

    expect(normalizeShopDomain(`https://www.${domain}/products/test`)).toBe(domain);
    expect(second.id).toBe(first.id);
    expect(count.count).toBe(1);
  });

  it("allows multiple accounts to connect to one canonical shop", async () => {
    const domain = uniqueDomain("multi-account");
    const shop = await getOrCreateShop(domain);
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const userC = await createUser("Account C");

    const connections = await Promise.all([
      getOrCreateAccountShopConnection(userA, shop.id, {
        accessToken: "encrypted-a",
      }),
      getOrCreateAccountShopConnection(userB, shop.id, {
        accessToken: "encrypted-b",
      }),
      getOrCreateAccountShopConnection(userC, shop.id, {
        accessToken: "encrypted-c",
      }),
    ]);

    const db = await requireDb();
    const [shopCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(eq(shops.id, shop.id));
    const [connectionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountShopConnections)
      .where(eq(accountShopConnections.shopId, shop.id));

    expect(new Set(connections.map(connection => connection.shopId))).toEqual(
      new Set([shop.id])
    );
    expect(shopCount.count).toBe(1);
    expect(connectionCount.count).toBe(3);
    expect(connections.map(connection => connection.accessToken)).toEqual([
      "encrypted-a",
      "encrypted-b",
      "encrypted-c",
    ]);
  });

  it("allows one account to keep four independent shop connections", async () => {
    const userA = await createUser("Account A");
    const domains = [
      uniqueDomain("account-a-1"),
      uniqueDomain("account-a-2"),
      uniqueDomain("account-a-3"),
      uniqueDomain("account-a-4"),
    ];
    const canonicalShops = await Promise.all(domains.map(domain => getOrCreateShop(domain)));
    const connections = await Promise.all(
      canonicalShops.map((shop, index) =>
        getOrCreateAccountShopConnection(userA, shop.id, {
          accessToken: `encrypted-a-${index + 1}`,
        })
      )
    );
    const db = await requireDb();
    const rows = await db
      .select({ shopId: accountShopConnections.shopId })
      .from(accountShopConnections)
      .where(eq(accountShopConnections.userId, userA));

    expect(new Set(rows.map(row => row.shopId))).toHaveLength(4);
    expect(connections).toHaveLength(4);
    expect(new Set(connections.map(connection => connection.accessToken))).toHaveLength(4);
  });

  it("keeps product reads inside the selected account/shop connection", async () => {
    const userA = await createUser("Account A");
    const shop1 = await getOrCreateShop(uniqueDomain("product-scope-1"));
    const shop2 = await getOrCreateShop(uniqueDomain("product-scope-2"));
    const connection1 = await getOrCreateAccountShopConnection(userA, shop1.id);
    const connection2 = await getOrCreateAccountShopConnection(userA, shop2.id);

    const product1 = await productService.create({
      userId: userA,
      storeId: connection1.id,
      title: "Store one product",
      sku: `STORE-ONE-${Date.now()}`,
      price: "10.00",
    });
    const product2 = await productService.create({
      userId: userA,
      storeId: connection2.id,
      title: "Store two product",
      sku: `STORE-TWO-${Date.now()}`,
      price: "20.00",
    });

    expect((await productService.getByUserId(userA, { storeId: connection1.id }))).toEqual(
      [expect.objectContaining({ id: product1.id })]
    );
    expect((await productService.getByUserId(userA, { storeId: connection2.id }))).toEqual(
      [expect.objectContaining({ id: product2.id })]
    );
    expect(await productService.getById(userA, product2.id, connection1.id)).toBeUndefined();
  });

  it("deduplicates concurrent canonical shop creation", async () => {
    const domain = uniqueDomain("concurrent");
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        getOrCreateShop(`https://www.${domain}/products/test`)
      )
    );
    const db = await requireDb();
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shops)
      .where(eq(shops.normalizedDomain, domain));

    expect(new Set(created.map(shop => shop.id))).toHaveLength(1);
    expect(count.count).toBe(1);
  });

  it("supports many-to-many account/shop combinations", async () => {
    const domains = [
      uniqueDomain("matrix-1"),
      uniqueDomain("matrix-2"),
      uniqueDomain("matrix-3"),
    ];
    const [shop1, shop2, shop3] = await Promise.all(
      domains.map(domain => getOrCreateShop(domain))
    );
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const userC = await createUser("Account C");
    await Promise.all([
      getOrCreateAccountShopConnection(userA, shop1.id),
      getOrCreateAccountShopConnection(userA, shop2.id),
      getOrCreateAccountShopConnection(userB, shop1.id),
      getOrCreateAccountShopConnection(userB, shop3.id),
      getOrCreateAccountShopConnection(userC, shop1.id),
      getOrCreateAccountShopConnection(userC, shop2.id),
    ]);
    const db = await requireDb();
    const rows = await db
      .select({ userId: accountShopConnections.userId, shopId: accountShopConnections.shopId })
      .from(accountShopConnections)
      .where(inArray(accountShopConnections.userId, [userA, userB, userC]));

    expect(rows).toHaveLength(6);
    expect(new Set(rows.map(row => row.shopId))).toHaveLength(3);
    expect(new Set(rows.map(row => `${row.userId}:${row.shopId}`))).toHaveLength(6);
  });

  it("reuses one account connection and isolates credentials", async () => {
    const domain = uniqueDomain("isolation");
    const shop = await getOrCreateShop(domain);
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const connectionA = await getOrCreateAccountShopConnection(userA, shop.id, {
      accessToken: "encrypted-a",
    });
    const repeatedA = await getOrCreateAccountShopConnection(userA, shop.id, {
      accessToken: "encrypted-a-updated",
    });
    const connectionB = await getOrCreateAccountShopConnection(userB, shop.id, {
      accessToken: "encrypted-b",
    });

    expect(repeatedA.id).toBe(connectionA.id);
    expect(repeatedA.accessToken).toBe("encrypted-a-updated");
    expect(await getAccountShopConnection(userA, connectionB.id)).toBeUndefined();
  });

  it("rejects product access through a foreign or inactive connection", async () => {
    const domain = uniqueDomain("authorization");
    const shop = await getOrCreateShop(domain);
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const connectionA = await getOrCreateAccountShopConnection(userA, shop.id);
    const db = await requireDb();

    await expect(productService.getByStoreId(userB, connectionA.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await db
      .update(accountShopConnections)
      .set({ connectionStatus: "inactive", isActive: false })
      .where(eq(accountShopConnections.id, connectionA.id));

    await expect(productService.getByStoreId(userA, connectionA.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps the canonical shop and other accounts connected after disconnect", async () => {
    const domain = uniqueDomain("disconnect");
    const shop = await getOrCreateShop(domain);
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const connectionA = await getOrCreateAccountShopConnection(userA, shop.id);
    const connectionB = await getOrCreateAccountShopConnection(userB, shop.id);
    const db = await requireDb();

    await db
      .update(accountShopConnections)
      .set({ connectionStatus: "inactive", isActive: false, accessToken: null })
      .where(
        and(
          eq(accountShopConnections.id, connectionA.id),
          eq(accountShopConnections.userId, userA)
        )
      );

    expect(await getAccountShopConnection(userA, connectionA.id)).toBeUndefined();
    expect(await getAccountShopConnection(userB, connectionB.id)).toMatchObject({
      connection: { id: connectionB.id, isActive: true },
      shop: { id: shop.id, normalizedDomain: domain },
    });
    expect(
      await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shop.id))
    ).toHaveLength(1);
  });

  it("disconnects one of an account's shops without affecting its other shops", async () => {
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const shop1 = await getOrCreateShop(uniqueDomain("disconnect-a-1"));
    const shop2 = await getOrCreateShop(uniqueDomain("disconnect-a-2"));
    const connectionA1 = await getOrCreateAccountShopConnection(userA, shop1.id, {
      accessToken: "encrypted-shop-1",
    });
    const connectionA2 = await getOrCreateAccountShopConnection(userA, shop2.id, {
      accessToken: "encrypted-shop-2",
    });
    const connectionB2 = await getOrCreateAccountShopConnection(userB, shop2.id, {
      accessToken: "encrypted-b-shop-2",
    });
    const db = await requireDb();

    await db
      .update(accountShopConnections)
      .set({ connectionStatus: "inactive", isActive: false, accessToken: null })
      .where(
        and(
          eq(accountShopConnections.id, connectionA2.id),
          eq(accountShopConnections.userId, userA)
        )
      );

    expect(await getAccountShopConnection(userA, connectionA1.id)).toMatchObject({
      connection: { id: connectionA1.id, accessToken: "encrypted-shop-1" },
    });
    expect(await getAccountShopConnection(userA, connectionA2.id)).toBeUndefined();
    expect(await getAccountShopConnection(userB, connectionB2.id)).toMatchObject({
      connection: { id: connectionB2.id, accessToken: "encrypted-b-shop-2" },
    });
  });

  it("canonicalizes the same competitor for different accounts", async () => {
    const domain = uniqueDomain("competitor");
    const userA = await createUser("Account A");
    const userB = await createUser("Account B");
    const competitorA = await findOrCreateCompetitor(
      userA,
      `https://www.${domain}/products/a`,
      "Shared Competitor"
    );
    const competitorB = await findOrCreateCompetitor(
      userB,
      `http://${domain}/products/b`,
      "Shared Competitor"
    );
    createdCompetitorIds.push(competitorA.id);
    const db = await requireDb();

    expect(competitorB.id).toBe(competitorA.id);
    expect(competitorB.domain).toBe(domain);
    expect(
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(competitors)
        .where(eq(competitors.id, competitorA.id))
    ).toEqual([{ count: 1 }]);
    expect(
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountCompetitorConnections)
        .where(eq(accountCompetitorConnections.competitorId, competitorA.id))
    ).toEqual([{ count: 2 }]);
  });
});
