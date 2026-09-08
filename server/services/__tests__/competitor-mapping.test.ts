import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { competitorService } from "../competitor.service";
import { productService } from "../product.service";
import {
  users,
  products,
  shops,
  accountShopConnections,
  accountCompetitorConnections,
  competitors,
  priceHistory,
} from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";
import {
  addManualCompetitorProduct,
} from "../competitor.service";
import { getOrCreateAccountShopConnection, getOrCreateShop, normalizeShopDomain } from "../shop.service";

async function createUser(email: string): Promise<string> {
  const db = await requireDb();
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: "Mapping Test User",
      passwordHash: "hashed",
      role: "user",
    })
    .returning();
  return user.id;
}

async function createStore(userId: string): Promise<string> {
  const db = await requireDb();
  const shop = await getOrCreateShop(`mapping-${Date.now()}-${Math.random()}.myshopify.com`, { database: db });
  const connection = await getOrCreateAccountShopConnection(userId, shop.id, { database: db });
  return connection.id;
}

async function createCompetitor(userId: string, name: string) {
  const db = await requireDb();
  const domain = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2)}.example.com`;
  const shop = await getOrCreateShop(domain, { database: db });
  const [competitor] = await db
    .insert(competitors)
    .values({
      shopId: shop.id,
      name,
      domain,
      status: "active",
    })
    .returning();
  await db.insert(accountCompetitorConnections).values({ userId, competitorId: competitor.id });
  return competitor;
}

describe("competitor product mappings", () => {
  let userId: string;
  let storeId: string;

  beforeEach(async () => {
    userId = await createUser(
      `mapping-${Date.now()}-${Math.random()}@example.com`
    );
    storeId = await createStore(userId);
  });

  afterEach(async () => {
    const db = await requireDb();
    const connectionRows = await db
      .select({ shopId: accountShopConnections.shopId })
      .from(accountShopConnections)
      .where(eq(accountShopConnections.userId, userId));
    const competitorRows = await db
      .select({ id: competitors.id, shopId: competitors.shopId })
      .from(competitors)
      .innerJoin(
        accountCompetitorConnections,
        eq(accountCompetitorConnections.competitorId, competitors.id)
      )
      .where(eq(accountCompetitorConnections.userId, userId));
    if (competitorRows.length > 0) {
      await db.delete(accountCompetitorConnections).where(eq(accountCompetitorConnections.userId, userId));
      for (const row of competitorRows) {
        await db.delete(competitors).where(eq(competitors.id, row.id));
        await db.delete(shops).where(eq(shops.id, row.shopId));
      }
    }
    await db.delete(products).where(eq(products.userId, userId));
    await db.delete(accountShopConnections).where(eq(accountShopConnections.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    for (const row of connectionRows) {
      await db.delete(shops).where(eq(shops.id, row.shopId));
    }
  });

  it("returns mappings for the owning catalog product", async () => {
    const product = await productService.create({
      userId,
      storeId,
      title: "Mapping Product",
      sku: "MAP-001",
      price: "49.99",
    });
    const competitor = await createCompetitor(userId, "Acme Market");

    await competitorService.addProduct(userId, {
      competitorId: competitor.id,
      productId: product.id,
      competitorProductTitle: "Mapping Product at Acme",
      competitorProductUrl: "https://acme.example.com/mapping-product",
      price: "44.99",
      currency: "USD",
      matchScore: 1,
      matchMethod: "manual",
      isVerified: false,
      isActive: true,
    });

    const mappings = await productService.getCompetitorPricesForUser(userId);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      productId: product.id,
      competitorId: competitor.id,
      competitorName: "Acme Market",
      title: "Mapping Product at Acme",
      price: "44.99",
    });
  });

  it("rejects duplicate links for the same product and competitor", async () => {
    const product = await productService.create({
      userId,
      storeId,
      title: "Duplicate Mapping Product",
      price: "19.99",
    });
    const competitor = await createCompetitor(userId, "Duplicate Market");
    const input = {
      competitorId: competitor.id,
      productId: product.id,
      competitorProductTitle: "Duplicate Product",
      price: "18.99",
      currency: "USD",
      matchScore: 1,
      matchMethod: "manual",
      isVerified: false,
      isActive: true,
    } as const;

    await competitorService.addProduct(userId, input);
    await expect(
      competitorService.addProduct(userId, input)
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("reuses an existing competitor and records a manual price", async () => {
    const product = await productService.create({
      userId,
      storeId,
      title: "Manual Mapping Product",
      price: "29.99",
    });
    const competitor = await createCompetitor(userId, "Reusable Market");

    const result = await addManualCompetitorProduct(userId, {
      productId: product.id,
      competitorUrl: `https://www.${competitor.domain}/products/item`,
      price: "27.49",
      storeId,
    });

    expect(result).toMatchObject({
      competitorId: competitor.id,
      productId: product.id,
      price: "27.49",
      matchMethod: "manual",
      isVerified: false,
    });

    const history = await dbRowsForManualPrice(result.id);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe("manual");
  });

  it("rolls back a newly created competitor when adding its product fails", async () => {
    const domain = `rollback-${Date.now()}-${Math.random().toString(36).slice(2)}.example.com`;

    await expect(
      addManualCompetitorProduct(userId, {
        productId: "00000000-0000-0000-0000-000000000099",
        competitorUrl: `https://${domain}/product`,
        price: "12.00",
        storeId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const db = await requireDb();
    const normalizedDomain = normalizeShopDomain(domain);
    const competitorRows = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.domain, normalizedDomain));
    const shopRows = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.normalizedDomain, normalizedDomain));
    expect(competitorRows).toHaveLength(0);
    expect(shopRows).toHaveLength(0);
  });

});

async function dbRowsForManualPrice(competitorProductId: string) {
  const db = await requireDb();
  return db
    .select({ source: priceHistory.source })
    .from(priceHistory)
    .where(eq(priceHistory.competitorProductId, competitorProductId));
}
