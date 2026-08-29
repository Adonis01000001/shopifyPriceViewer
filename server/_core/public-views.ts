import {
  accountShopConnections,
  shops,
  type AccountShopConnection,
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
  id: accountShopConnections.id,
  shopId: accountShopConnections.shopId,
  shopDomain: shops.normalizedDomain,
  scopes: accountShopConnections.scopes,
  storeName: accountShopConnections.storeName,
  storeEmail: accountShopConnections.storeEmail,
  currency: accountShopConnections.currency,
  timezone: accountShopConnections.timezone,
  isActive: accountShopConnections.isActive,
  connectionStatus: accountShopConnections.connectionStatus,
  lastSyncedAt: accountShopConnections.lastSyncedAt,
  createdAt: accountShopConnections.createdAt,
  updatedAt: accountShopConnections.updatedAt,
} as const;

export type PublicShopifyStore = {
  id: AccountShopConnection["id"];
  shopId: AccountShopConnection["shopId"];
  shopDomain: string;
  scopes: AccountShopConnection["scopes"];
  storeName: AccountShopConnection["storeName"];
  storeEmail: AccountShopConnection["storeEmail"];
  currency: AccountShopConnection["currency"];
  timezone: AccountShopConnection["timezone"];
  isActive: AccountShopConnection["isActive"];
  connectionStatus: AccountShopConnection["connectionStatus"];
  lastSyncedAt: AccountShopConnection["lastSyncedAt"];
  createdAt: AccountShopConnection["createdAt"];
  updatedAt: AccountShopConnection["updatedAt"];
};

export function toPublicShopifyStore(
  store: PublicShopifyStore
): PublicShopifyStore {
  return store;
}
