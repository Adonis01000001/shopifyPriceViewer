import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { competitorService } from "../competitor.service";
import { productService } from "../product.service";
import {
  users,
  products,
  shopifyStores,
  competitors,
} from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";

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
  const [store] = await db
    .insert(shopifyStores)
    .values({
      userId,
      shopDomain: `mapping-${Date.now()}.myshopify.com`,
      accessToken: "test-token",
      scopes: "read_products",
      isActive: true,
    })
    .returning();
  return store.id;
}

async function createCompetitor(userId: string, name: string) {
  const db = await requireDb();
  const [competitor] = await db
    .insert(competitors)
    .values({
      userId,
      name,
      domain: `${name.toLowerCase()}.example.com`,
      status: "active",
    })
    .returning();
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
    await db.delete(shopifyStores).where(eq(shopifyStores.userId, userId));
    await db.delete(products).where(eq(products.userId, userId));
    await db.delete(competitors).where(eq(competitors.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
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

});
