import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { productService } from "../product.service";
import { users, products, shops, accountShopConnections } from "../../../drizzle/schema";
import { requireDb } from "../../_core/db-assert";
import { getOrCreateAccountShopConnection, getOrCreateShop } from "../shop.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createTestUser(email: string): Promise<string> {
  const db = await requireDb();
  const result = await db
    .insert(users)
    .values({
      email,
      name: "Test User",
      passwordHash: "hashed",
      role: "user",
    })
    .returning();
  return result[0].id;
}

async function createTestStore(userId: string): Promise<string> {
  const db = await requireDb();
  const shop = await getOrCreateShop(`test-${Date.now()}-${Math.random()}.myshopify.com`, { database: db });
  const connection = await getOrCreateAccountShopConnection(userId, shop.id, {
    accessToken: "test-token",
    scopes: "read_products",
    database: db,
  });
  return connection.id;
}

async function cleanUp(userId: string) {
  const db = await requireDb();
  const connectionRows = await db
    .select({ shopId: accountShopConnections.shopId })
    .from(accountShopConnections)
    .where(eq(accountShopConnections.userId, userId));
  await db.delete(products).where(eq(products.userId, userId));
  await db.delete(accountShopConnections).where(eq(accountShopConnections.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  for (const row of connectionRows) {
    await db.delete(shops).where(eq(shops.id, row.shopId));
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ProductService SKU workflow", () => {
  let userId: string;
  let storeId: string;

  beforeEach(async () => {
    userId = await createTestUser(`test-${Date.now()}@example.com`);
    storeId = await createTestStore(userId);
  });

  afterEach(async () => {
    await cleanUp(userId);
  });

  // ── Create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a product with SKU", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "Wireless Earbuds",
        sku: "ABC-123",
        price: "49.99",
      });
      expect(product.id).toBeDefined();
      expect(product.sku).toBe("ABC-123");
      expect(product.title).toBe("Wireless Earbuds");
      expect(product.price).toBe("49.99");
    });

    it("creates a product without SKU", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "USB-C Hub",
        price: "34.99",
      });
      expect(product.id).toBeDefined();
      expect(product.sku).toBeNull();
    });

    it("normalizes SKU to uppercase (abc-123 → ABC-123)", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "Mechanical Keyboard",
        sku: "  abc-123  ",
        price: "89.99",
      });
      expect(product.sku).toBe("ABC-123");
    });

    it("rejects duplicate SKU for the same user", async () => {
      await productService.create({
        userId,
        storeId,
        title: "First Product",
        sku: "DUPLICATE-1",
        price: "10.00",
      });

      await expect(
        productService.create({
          userId,
          storeId,
          title: "Second Product",
          sku: "DUPLICATE-1",
          price: "20.00",
        })
      ).rejects.toThrow(/SKU/i);
    });

    it("allows different users to use the same SKU", async () => {
      const otherUserId = await createTestUser(
        `other-${Date.now()}@example.com`
      );
      const otherStoreId = await createTestStore(otherUserId);

      await productService.create({
        userId,
        storeId,
        title: "User 1 Product",
        sku: "SHARED-SKU",
        price: "10.00",
      });

      const otherProduct = await productService.create({
        userId: otherUserId,
        storeId: otherStoreId,
        title: "User 2 Product",
        sku: "SHARED-SKU",
        price: "20.00",
      });

      expect(otherProduct.sku).toBe("SHARED-SKU");
      await cleanUp(otherUserId);
    });

    it("rejects duplicate Product Name when no SKU", async () => {
      await productService.create({
        userId,
        storeId,
        title: "Unique Product",
        price: "10.00",
      });

      await expect(
        productService.create({
          userId,
          storeId,
          title: "Unique Product",
          price: "20.00",
        })
      ).rejects.toThrow(/named/i);
    });

    it("rejects product name shorter than 2 characters", async () => {
      await expect(
        productService.create({
          userId,
          storeId,
          title: "A",
          price: "10.00",
        })
      ).rejects.toThrow();
    });
  });

  // ── Update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates SKU", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "Update Test",
        sku: "OLD-SKU",
        price: "10.00",
      });

      const updated = await productService.update(userId, product.id, {
        sku: "NEW-SKU",
      });

      expect(updated).toBeDefined();
      expect(updated!.sku).toBe("NEW-SKU");
    });

    it("removes SKU (set to empty)", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "Remove SKU Test",
        sku: "TO-REMOVE",
        price: "10.00",
      });

      const updated = await productService.update(userId, product.id, {
        sku: "",
      });

      expect(updated).toBeDefined();
      expect(updated!.sku).toBeNull();
    });

    it("rejects duplicate SKU on update", async () => {
      const p1 = await productService.create({
        userId,
        storeId,
        title: "Product 1",
        sku: "SKU-A",
        price: "10.00",
      });

      await productService.create({
        userId,
        storeId,
        title: "Product 2",
        sku: "SKU-B",
        price: "20.00",
      });

      await expect(
        productService.update(userId, p1.id, { sku: "SKU-B" })
      ).rejects.toThrow(/SKU/i);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────────

  describe("tracking", () => {
    it("persists the monitoring state", async () => {
      const product = await productService.create({
        userId,
        storeId,
        title: "Tracking Test",
        price: "10.00",
      });

      const untracked = await productService.toggleTracking(
        userId,
        product.id,
        false
      );
      expect(untracked?.isTracked).toBe(false);

      const tracked = await productService.toggleTracking(
        userId,
        product.id,
        true
      );
      expect(tracked?.isTracked).toBe(true);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await productService.create({
        userId,
        storeId,
        title: "Wireless Bluetooth Earbuds",
        sku: "ELEC-001",
        price: "49.99",
      });
      await productService.create({
        userId,
        storeId,
        title: "USB-C Hub 7-in-1",
        sku: "ELEC-002",
        price: "34.99",
      });
      await productService.create({
        userId,
        storeId,
        title: "Mechanical Keyboard RGB",
        price: "89.99",
      });
    });

    it("finds product by SKU (exact match)", async () => {
      const results = await productService.search(userId, "ELEC-001");
      expect(results.length).toBeGreaterThanOrEqual(1);
      const skuMatch = results.find(p => p.sku === "ELEC-001");
      expect(skuMatch).toBeDefined();
    });

    it("finds product by SKU (case-insensitive)", async () => {
      const results = await productService.search(userId, "elec-001");
      const skuMatch = results.find(p => p.sku === "ELEC-001");
      expect(skuMatch).toBeDefined();
    });

    it("finds product by name (fuzzy match)", async () => {
      const results = await productService.search(userId, "keyboard");
      expect(results.length).toBeGreaterThanOrEqual(1);
      const nameMatch = results.find(p =>
        p.title.toLowerCase().includes("keyboard")
      );
      expect(nameMatch).toBeDefined();
    });

    it("prioritizes SKU match over name match", async () => {
      await productService.create({
        userId,
        storeId,
        title: "ELEC-001 Cable",
        sku: "CABLE-001",
        price: "9.99",
      });

      const results = await productService.search(userId, "ELEC-001");
      expect(results[0].sku).toBe("ELEC-001");
    });
  });

  // ── Backward compatibility ──────────────────────────────────────────────

  describe("backward compatibility", () => {
    it("existing products without SKU still work", async () => {
      const db = await requireDb();
      const legacyProduct = await db
        .insert(products)
        .values({
          userId,
          storeId,
          title: "Legacy Product",
          price: "19.99",
          status: "optimal",
          isTracked: true,
          isActive: true,
          sku: null,
        })
        .returning();

      expect(legacyProduct[0].sku).toBeNull();

      const results = await productService.search(userId, "Legacy Product");
      expect(results.length).toBeGreaterThanOrEqual(1);

      const updated = await productService.update(userId, legacyProduct[0].id, {
        price: "29.99",
      });
      expect(updated).toBeDefined();
      expect(updated!.price).toBe("29.99");
    });
  });
});
