import type { RouterOutputs } from "@/lib/trpc";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";

type ConnectedShop = RouterOutputs["shopify"]["listStores"][number];

type ShopContextValue = {
  shops: ConnectedShop[];
  selectedShopId: string | null;
  selectedShop: ConnectedShop | undefined;
  routeShopId: string | null;
  isRouteScoped: boolean;
  setSelectedShopId: (connectionId: string) => void;
};

const ShopContext = createContext<ShopContextValue | null>(null);

function storageKey(userId: string) {
  return `priceintel.selected-shop-connection.${userId}`;
}

export function getRouteShopId(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getStoreDashboardPath(
  connectionId: string,
  path: string = "/"
): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/dashboard/${encodeURIComponent(connectionId)}${suffix}`;
}

export function getStorePathForLocation(
  connectionId: string,
  location: string
): string {
  const match = location.match(/^\/dashboard\/[^/]+(\/.*)?$/);
  const section = match
    ? match[1] ?? "/"
    : location.startsWith("/")
      ? location
      : "/";
  return getStoreDashboardPath(connectionId, section || "/");
}

export function ShopContextProvider({
  userId,
  shops,
  children,
}: {
  userId: string;
  shops: ConnectedShop[];
  children: React.ReactNode;
}) {
  const [location] = useLocation();
  const routeShopId = getRouteShopId(location);
  const isRouteScoped = routeShopId !== null;
  const previousUserId = useRef(userId);
  const [selectedShopId, setSelectedShopIdState] = useState<string | null>(() => {
    try {
      if (routeShopId) return routeShopId;
      const connectedShopId = new URLSearchParams(window.location.search).get(
        "shopify_connection"
      );
      return connectedShopId || window.localStorage.getItem(storageKey(userId));
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (routeShopId) setSelectedShopIdState(routeShopId);
  }, [routeShopId]);

  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    try {
      setSelectedShopIdState(window.localStorage.getItem(storageKey(userId)));
    } catch {
      setSelectedShopIdState(null);
    }
  }, [userId]);

  const selectedShop = useMemo(
    () => shops.find(shop => shop.id === selectedShopId),
    [selectedShopId, shops]
  );

  useEffect(() => {
    const stillConnected = shops.some(shop => shop.id === selectedShopId);
    // An explicit dashboard URL is authoritative for the UI. Do not silently
    // fall back to another store when a user follows an invalid/unauthorized
    // deep link.
    if (isRouteScoped || stillConnected || shops.length === 0) return;
    setSelectedShopIdState(shops[0].id);
  }, [isRouteScoped, selectedShopId, shops]);

  useEffect(() => {
    try {
      if (selectedShopId) {
        window.localStorage.setItem(storageKey(userId), selectedShopId);
      } else {
        window.localStorage.removeItem(storageKey(userId));
      }
    } catch {
      // Storage is only a convenience; it must not block the dashboard.
    }
  }, [selectedShopId, userId]);

  const setSelectedShopId = useCallback(
    (connectionId: string) => {
      if (!shops.some(shop => shop.id === connectionId)) return;
      setSelectedShopIdState(connectionId);
    },
    [shops]
  );

  const value = useMemo(
    () => ({
      shops,
      selectedShopId,
      selectedShop,
      routeShopId,
      isRouteScoped,
      setSelectedShopId,
    }),
    [isRouteScoped, routeShopId, selectedShop, selectedShopId, setSelectedShopId, shops]
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShopContext() {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error("useShopContext must be used inside ShopContextProvider");
  }
  return context;
}
