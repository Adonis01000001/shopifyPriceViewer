export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// API base URL for backend requests.
const API_URL = import.meta.env.VITE_API_URL || "";

/**
 * Build the Shopify OAuth connect URL.
 * The backend handles the OAuth flow — no external OAuth portal needed.
 *
 * Usage in frontend:
 *   window.location.href = getShopifyConnectUrl("mystore.myshopify.com");
 */
export const getShopifyConnectUrl = (shop: string): string => {
  const params = new URLSearchParams({ shop });
  return `${API_URL}/api/v1/shopify/connect?${params.toString()}`;
};

/**
 * Navigate the user to Shopify OAuth to connect their store.
 */
export const redirectToShopifyConnect = (shop: string): void => {
  window.location.href = getShopifyConnectUrl(shop);
};

/**
 * Get the login URL. In dev bypass mode, redirects to dashboard.
 */
export const getLoginUrl = (): string => {
  if (import.meta.env.VITE_BYPASS_AUTH === "true") {
    return "/";
  }
  const apiUrl = import.meta.env.VITE_API_URL || "";
  return `${apiUrl}/api/v1/shopify/connect`;
};
