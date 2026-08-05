import {
  shopifyStores,
  type ShopifyStore,
  type User,
} from "../../drizzle/schema";
import type { PublicUser } from "../../shared/types";

export type { PublicUser };

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatarUrl,
    loginMethod: user.loginMethod,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignedIn: user.lastSignedIn,
  };
}

export const publicShopifyStoreColumns = {
  id: shopifyStores.id,
  shopDomain: shopifyStores.shopDomain,
  scopes: shopifyStores.scopes,
  storeName: shopifyStores.storeName,
  storeEmail: shopifyStores.storeEmail,
  currency: shopifyStores.currency,
  timezone: shopifyStores.timezone,
  isActive: shopifyStores.isActive,
  lastSyncedAt: shopifyStores.lastSyncedAt,
  createdAt: shopifyStores.createdAt,
  updatedAt: shopifyStores.updatedAt,
} as const;

export type PublicShopifyStore = Omit<ShopifyStore, "userId" | "accessToken">;

export function toPublicShopifyStore(
  store: ShopifyStore
): PublicShopifyStore {
  const { userId: _userId, accessToken: _accessToken, ...publicStore } = store;
  return publicStore;
}
