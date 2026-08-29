import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  accountShopConnections,
  shops,
  type AccountShopConnection,
  type Shop,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import type { AppDatabase, AppDatabaseTransaction } from "../db";

export type ShopDatabase = AppDatabase | AppDatabaseTransaction;

/**
 * Resolve a user-entered URL to the canonical host identity used for lookup.
 * Paths, schemes, default ports, a leading www, and a trailing dot do not
 * change the shop identity. Other subdomains are intentionally preserved.
 */
export function normalizeShopDomain(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shop URL or domain is required",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a valid shop URL or domain",
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shop URL must use http or https",
    });
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shop URL must contain a public domain",
    });
  }

  return parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function inferShopPlatform(domain: string): string | null {
  if (domain.endsWith(".myshopify.com")) return "shopify";
  return null;
}

export async function getOrCreateShop(
  rawDomain: string,
  options?: {
    name?: string | null;
    platform?: string | null;
    metadata?: unknown;
    database?: ShopDatabase;
  }
): Promise<Shop> {
  const database = options?.database ?? (await requireDb());
  const normalizedDomain = normalizeShopDomain(rawDomain);
  const [created] = await database
    .insert(shops)
    .values({
      canonicalDomain: normalizedDomain,
      normalizedDomain,
      name: options?.name?.trim() || normalizedDomain,
      platform: options?.platform ?? inferShopPlatform(normalizedDomain),
      metadata: options?.metadata,
    })
    .onConflictDoNothing({ target: shops.normalizedDomain })
    .returning();

  if (created) return created;

  const [existing] = await database
    .select()
    .from(shops)
    .where(eq(shops.normalizedDomain, normalizedDomain))
    .limit(1);
  if (!existing) {
    throw new Error("Shop creation conflict did not return the canonical shop");
  }
  return existing;
}

export async function getOrCreateAccountShopConnection(
  userId: string,
  shopId: string,
  data: Partial<
    Pick<
      AccountShopConnection,
      | "accessToken"
      | "scopes"
      | "connectionSettings"
      | "syncSettings"
      | "storeName"
      | "storeEmail"
      | "currency"
      | "timezone"
    >
  > & { database?: ShopDatabase } = {}
): Promise<AccountShopConnection> {
  const database = data.database ?? (await requireDb());
  const { database: _database, ...connectionData } = data;
  const [connection] = await database
    .insert(accountShopConnections)
    .values({
      userId,
      shopId,
      ...connectionData,
      connectionStatus: "active",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [accountShopConnections.userId, accountShopConnections.shopId],
      set: {
        ...connectionData,
        connectionStatus: "active",
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!connection) throw new Error("Failed to create shop connection");
  return connection;
}

export async function getAccountShopConnection(
  userId: string,
  connectionId: string,
  database?: ShopDatabase
) {
  const connection = database ?? (await requireDb());
  const [row] = await connection
    .select({ connection: accountShopConnections, shop: shops })
    .from(accountShopConnections)
    .innerJoin(shops, eq(accountShopConnections.shopId, shops.id))
    .where(
      and(
        eq(accountShopConnections.id, connectionId),
        eq(accountShopConnections.userId, userId),
        eq(accountShopConnections.isActive, true)
      )
    )
    .limit(1);
  return row;
}
