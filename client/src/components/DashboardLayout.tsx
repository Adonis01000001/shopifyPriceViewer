import type { PublicUser } from "@shared/types";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  RefreshCw,
  Search,
  Settings2,
  Store,
  Sun,
  Target,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import Papa from "papaparse";
import { toast } from "sonner";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import PipelineActivity from "@/components/dashboard/PipelineActivity";
import { useTheme } from "@/contexts/ThemeContext";
import {
  getStorePathForLocation,
  getStoreDashboardPath,
  ShopContextProvider,
  useShopContext,
} from "@/contexts/ShopContext";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import OnboardingWizard from "./dashboard/OnboardingWizard";

type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  adminOnly?: boolean;
};

// Five destinations do not need three headings above them. The labels match
// the page each one opens, so the sidebar and the page agree on the name.
const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: "What to do", path: "/" },
  { icon: Package, label: "Your products", path: "/products" },
  { icon: Users, label: "Competitors", path: "/competitors" },
  { icon: Bell, label: "Price changes", path: "/alerts" },
  { icon: Settings2, label: "Settings", path: "/settings" },
];

const getInitials = (name?: string | null) => {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return "PI";
  return words
    .slice(0, 2)
    .map(word => word[0])
    .join("")
    .toUpperCase();
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const { data: user, isLoading } = trpc.auth.me.useQuery();
  const productsQuery = trpc.products.list.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const storesQuery = trpc.shopify.listStores.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const products = productsQuery.data;
  const stores = storesQuery.data;
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Opening the checklist is a one-off. Without this the effect below reopened
  // it every time a background refetch handed back a new array, which put it
  // back on screen every minute while a run was in progress.
  const onboardingOffered = useRef(false);

  // Coming back from Shopify, the cached answers are a minute old and still
  // say "no store", which left the checklist showing step one as unfinished
  // until something forced a refetch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("shopify_connected")) return;
    void utils.shopify.listStores.refetch();
    void utils.products.list.refetch();
    params.delete("shopify_connected");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (query ? `?${query}` : "")
    );
  }, [utils]);

  // Only decide once the answers are actually in. Reading a still-loading
  // query as "no store" reopened this checklist on every page change, and the
  // old condition also required a competitor — something the checklist stopped
  // asking for, so nothing could ever satisfy it.
  useEffect(() => {
    if (!user || isLoading) return;
    if (!storesQuery.isSuccess || !productsQuery.isSuccess) return;
    if (localStorage.getItem("onboarding-dismissed")) return;
    if (onboardingOffered.current) return;

    const setUp = stores!.length > 0 && products!.length > 0;
    if (!setUp) {
      onboardingOffered.current = true;
      setOnboardingOpen(true);
    }
  }, [
    user,
    isLoading,
    products,
    stores,
    productsQuery.isSuccess,
    storesQuery.isSuccess,
  ]);

  if (isLoading) return <DashboardLayoutSkeleton />;
  if (!user) return null;

  return (
    <div className="app-shell">
      <OnboardingWizard
        open={onboardingOpen}
        stores={stores ?? []}
        productCount={products?.length ?? 0}
        onOpenChange={setOnboardingOpen}
        onComplete={() => {
          localStorage.setItem("onboarding-dismissed", "true");
          setOnboardingOpen(false);
        }}
      />
      <ShopContextProvider userId={user.id} shops={stores ?? []}>
        <DashboardLayoutContent
          user={user}
          products={products ?? []}
          stores={stores ?? []}
          setupKnown={storesQuery.isSuccess && productsQuery.isSuccess}
          onResumeSetup={() => setOnboardingOpen(true)}
        >
          {children}
        </DashboardLayoutContent>
      </ShopContextProvider>
    </div>
  );
}

type DashboardLayoutContentProps = {
  user: PublicUser;
  products: RouterOutputs["products"]["list"];
  stores: RouterOutputs["shopify"]["listStores"];
  /** False until both setup questions have been answered by the server. */
  setupKnown: boolean;
  onResumeSetup: () => void;
  children: React.ReactNode;
};

function DashboardLayoutContent({
  user,
  products,
  stores,
  setupKnown,
  onResumeSetup,
  children,
}: DashboardLayoutContentProps) {
  const [location, setLocation] = useLocation();
  const {
    selectedShopId,
    selectedShop,
    isRouteScoped,
  } = useShopContext();
  const { theme, toggleTheme, switchable } = useTheme();
  const utils = trpc.useUtils();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  useRealtimeNotifications();

  const scopedProductsQuery = trpc.products.list.useQuery(
    selectedShopId ? { storeId: selectedShopId } : undefined,
    { enabled: !!selectedShopId, staleTime: 60_000 }
  );
  const dashboardProducts = selectedShopId
    ? (scopedProductsQuery.data ?? [])
    : products;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(searchQuery.trim()),
      280
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setMobileNavOpen(false);
    setSearchOpen(false);
  }, [location]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) {
        setSearchOpen(false);
      }
      if (
        notificationRef.current &&
        !notificationRef.current.contains(target)
      ) {
        setNotificationOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = searchRef.current?.querySelector("input");
        input?.focus();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const productSearch = trpc.products.search.useQuery(
    { query: debouncedQuery, storeId: selectedShopId ?? undefined },
    { enabled: debouncedQuery.length >= 2 && !!selectedShopId }
  );
  const competitorSearch = trpc.competitors.search.useQuery(
    { query: debouncedQuery, storeId: selectedShopId ?? undefined },
    { enabled: debouncedQuery.length >= 2 && !!selectedShopId }
  );

  const handleExport = useCallback(() => {
    if (!dashboardProducts.length) {
      toast.error("No products to export");
      return;
    }
    const rows = dashboardProducts.map(product => ({
      Title: product.title,
      SKU: product.sku ?? "",
      Category: product.category ?? "",
      Price: Number(product.price).toFixed(2),
      "Compare At": product.compareAtPrice
        ? Number(product.compareAtPrice).toFixed(2)
        : "",
      Status: product.status,
      Vendor: product.vendor ?? "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `priceintel-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${dashboardProducts.length} products`);
  }, [dashboardProducts]);

  const syncMutation = trpc.shopify.syncProducts.useMutation({
    onSuccess: data => {
      toast.success(data.message || `Synced ${data.synced} products`);
      // The sync starts a pipeline run. Without this the indicator sits on its
      // idle interval and takes up to a minute to notice, which reads as
      // nothing having happened at the exact moment something did.
      utils.pipeline.status.invalidate();
    },
    onError: error => toast.error(error.message || "Sync failed"),
  });

  const handleSync = useCallback(() => {
    const activeStore = selectedShop;
    if (!activeStore) {
      toast.error("Connect an active Shopify store first", {
        description: "Open Settings to connect your store.",
      });
      return;
    }
    syncMutation.mutate({ storeId: activeStore.id });
  }, [selectedShop, syncMutation]);

  const { data: alertStats } = trpc.alerts.stats.useQuery(
    selectedShopId ? { storeId: selectedShopId } : undefined
  );
  const { data: unreadAlerts, refetch: refetchAlerts } =
    trpc.alerts.list.useQuery({
      unreadOnly: true,
      limit: 10,
      storeId: selectedShopId ?? undefined,
    });
  const markReadMutation = trpc.alerts.markRead.useMutation({
    onSuccess: () => void refetchAlerts(),
  });
  const markAllReadMutation = trpc.alerts.markAllRead.useMutation({
    onSuccess: () => void refetchAlerts(),
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.cancel();
      window.location.replace("/auth");
    },
    onError: error =>
      toast.error(error.message || "Could not sign out. Please try again."),
  });

  const unreadCount = alertStats?.unread ?? 0;
  const notifications = unreadAlerts ?? [];
  const activeStore = selectedShop;
  const currentNav = navItems.find(item =>
    (() => {
      const scopedLocation = location.replace(/^\/dashboard\/[^/]+/, "") || "/";
      return item.path === "/"
        ? scopedLocation === "/"
        : scopedLocation === item.path || scopedLocation.startsWith(`${item.path}/`);
    })()
  );

  const navigateToStore = useCallback(
    (path: string) =>
      setLocation(selectedShopId ? getStoreDashboardPath(selectedShopId, path) : path),
    [selectedShopId, setLocation]
  );

  const getAlertIcon = (alertType: string) => {
    if (alertType === "price_drop") return ArrowDownRight;
    if (alertType === "price_increase") return ArrowUpRight;
    if (alertType === "competitor_change") return Activity;
    return Zap;
  };

  if (isRouteScoped && setupKnown && !selectedShop) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Store not found or unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This store is not connected to your account.
          </p>
          <button
            className="text-sm text-primary underline"
            onClick={() => setLocation("/settings")}
          >
            Return to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        id="primary-navigation"
        className={`app-sidebar ${mobileNavOpen ? "is-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="app-sidebar-header">
          <button
            type="button"
            className="app-brand"
            onClick={() => navigateToStore("/")}
            aria-label="Go to PriceIntel overview"
          >
            <span className="app-brand-mark" aria-hidden="true">
              <BarChart3 className="h-5 w-5" />
            </span>
            <span>
              <span className="app-brand-name">PriceIntel</span>
              <span className="app-brand-caption">Competitor pricing</span>
            </span>
          </button>
        </div>

        <div className="app-workspace">
          <span className="app-workspace-icon" aria-hidden="true">
            <Store className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="app-workspace-label">Active store</span>
            <select
              className="app-workspace-value w-full bg-transparent outline-none"
              value={selectedShopId ?? ""}
              onChange={event => {
                const nextId = event.target.value;
                if (!nextId) return;
                const nextPath = getStorePathForLocation(nextId, location);
                setLocation(nextPath);
              }}
              aria-label="Select active store"
            >
              {stores.length === 0 ? (
                <option value="">{setupKnown ? "No store connected" : "Loading\u2026"}</option>
              ) : (
                stores.map(store => (
                  <option key={store.id} value={store.id}>
                    {store.storeName ?? store.shopDomain}
                  </option>
                ))
              )}
            </select>
          </span>
        </div>

        <nav className="app-navigation">
          <div className="app-nav-group">
            {navItems
              .filter(item => !item.adminOnly || user.role === "admin")
              .map(item => {
                const scopedLocation = location.replace(/^\/dashboard\/[^/]+/, "") || "/";
                const isActive =
                  item.path === "/"
                    ? scopedLocation === "/"
                    : scopedLocation === item.path ||
                      scopedLocation.startsWith(`${item.path}/`);
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.path}
                    className={`app-nav-link ${isActive ? "is-active" : ""}`}
                    onClick={() =>
                      item.path === "/settings"
                        ? setLocation(item.path)
                        : navigateToStore(item.path)
                    }
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="app-nav-link-icon" aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="app-nav-link-label">{item.label}</span>
                    {isActive && <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
          </div>
        </nav>

        <div className="app-sidebar-footer">
          {switchable && (
            <button
              type="button"
              className="app-theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-[var(--warning)]" />
              ) : (
                <Moon className="h-4 w-4 text-primary" />
              )}
              <span className="text-xs">
                {theme === "dark" ? "Use light theme" : "Use dark theme"}
              </span>
            </button>
          )}
          <div className="app-profile-wrap" ref={profileRef}>
            {profileOpen && (
              <div className="app-profile-popover" id="account-menu">
                <button
                  type="button"
                  className="app-profile-action is-danger"
                  onClick={() => {
                    setProfileOpen(false);
                    logoutMutation.mutate();
                  }}
                  disabled={logoutMutation.isPending}
                >
                  <LogOut className="h-4 w-4" />
                  {logoutMutation.isPending ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
            <button
              type="button"
              className="app-account-button"
              onClick={() => setProfileOpen(open => !open)}
              aria-expanded={profileOpen}
              aria-controls="account-menu"
              aria-label="Open account menu"
            >
              <span className="app-account-avatar" aria-hidden="true">
                {getInitials(user.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="app-account-name">
                  {user.name || "Merchant"}
                </span>
                <span className="app-account-role">Store owner</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          type="button"
          className="app-nav-scrim 2xl:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-leading flex-1">
            <button
              type="button"
              className="app-mobile-menu 2xl:hidden"
              onClick={() => setMobileNavOpen(open => !open)}
              aria-label={
                mobileNavOpen ? "Close navigation" : "Open navigation"
              }
              aria-expanded={mobileNavOpen}
              aria-controls="primary-navigation"
            >
              {mobileNavOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
            <div className="app-topbar-context hidden sm:block">
              <div className="app-topbar-eyebrow">Competitor pricing</div>
              <div className="app-topbar-title">
                {currentNav?.label ?? "PriceIntel"}
              </div>
            </div>
            <div className="app-search" ref={searchRef} role="search">
              <div className="app-search-field">
                <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={event => {
                    const value = event.target.value;
                    setSearchQuery(value);
                    setSearchOpen(value.trim().length >= 2);
                  }}
                  onFocus={() => {
                    if (searchQuery.trim().length >= 2) setSearchOpen(true);
                  }}
                  placeholder="Search products or competitors"
                  aria-label="Search products or competitors"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchOpen(false);
                    }}
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className="app-search-shortcut">Ctrl K</kbd>
                )}
              </div>
              {searchOpen && debouncedQuery.length >= 2 && (
                <div className="app-search-popover">
                  {(productSearch.isLoading || competitorSearch.isLoading) && (
                    <div className="flex items-center justify-center p-8 text-primary">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                  {!productSearch.isLoading &&
                    !competitorSearch.isLoading &&
                    !productSearch.data?.length &&
                    !competitorSearch.data?.length && (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        No matches for “{debouncedQuery}”
                      </div>
                    )}
                  {(productSearch.data?.length ?? 0) > 0 && (
                    <div>
                      <div className="app-search-section-label">Products</div>
                      {productSearch.data?.map(product => (
                        <button
                          type="button"
                          className="app-search-result"
                          key={product.id}
                          onClick={() => {
                            navigateToStore(`/products/${product.id}`);
                            setSearchQuery("");
                          }}
                        >
                          <span
                            className="app-search-result-icon"
                            aria-hidden="true"
                          >
                            <Package className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="app-search-result-title">
                              {product.title}
                            </span>
                            <span className="app-search-result-meta">
                              {product.sku || "No SKU"} · $
                              {Number(product.price).toFixed(2)}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                  {(competitorSearch.data?.length ?? 0) > 0 && (
                    <div>
                      <div className="app-search-section-label">
                        Competitors
                      </div>
                      {competitorSearch.data?.map(competitor => (
                        <button
                          type="button"
                          className="app-search-result"
                          key={competitor.id}
                          onClick={() => {
                            navigateToStore("/competitors");
                            setSearchQuery("");
                          }}
                        >
                          <span
                            className="app-search-result-icon"
                            aria-hidden="true"
                          >
                            <Store className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="app-search-result-title">
                              {competitor.name}
                            </span>
                            <span className="app-search-result-meta">
                              {competitor.domain}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="app-topbar-actions">
            {setupKnown && (stores.length === 0 || products.length === 0) && (
              <button
                type="button"
                className="app-topbar-button is-primary"
                onClick={onResumeSetup}
              >
                <Store className="h-3.5 w-3.5" />
                <span className="topbar-action-label">Finish setup</span>
              </button>
            )}
            <PipelineActivity storeId={selectedShopId ?? undefined} />
            <button
              type="button"
              className="app-topbar-button hidden xl:inline-flex"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="topbar-action-label">Export</span>
            </button>
            <button
              type="button"
              className="app-topbar-button is-primary"
              onClick={handleSync}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="topbar-action-label">
                {syncMutation.isPending ? "Syncing" : "Sync Shopify"}
              </span>
            </button>
            <div className="app-notification-wrap" ref={notificationRef}>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => setNotificationOpen(open => !open)}
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
                aria-expanded={notificationOpen}
                aria-controls="notification-center"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="app-notification-badge">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notificationOpen && (
                <div
                  className="app-notification-popover"
                  id="notification-center"
                >
                  <div className="app-popover-header">
                    <span className="app-popover-title">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        className="app-popover-link"
                        onClick={() => markAllReadMutation.mutate()}
                        disabled={markAllReadMutation.isPending}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="app-notification-list">
                    {notifications.length === 0 ? (
                      <div className="p-9 text-center">
                        <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-primary" />
                        <p className="text-sm font-semibold">All clear</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          New signals will appear here.
                        </p>
                      </div>
                    ) : (
                      notifications.map(alert => {
                        const AlertIcon = getAlertIcon(alert.alertType);
                        return (
                          <div className="app-notification-item" key={alert.id}>
                            <button
                              type="button"
                              className="app-notification-main"
                              onClick={() => {
                                markReadMutation.mutate({ id: alert.id });
                                navigateToStore("/alerts");
                              }}
                            >
                              <span
                                className="app-notification-icon"
                                aria-hidden="true"
                              >
                                <AlertIcon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="app-notification-title">
                                  {alert.title}
                                </span>
                                <span className="app-notification-message line-clamp-2">
                                  {alert.message}
                                </span>
                                <span className="app-notification-time">
                                  {new Date(alert.createdAt).toLocaleString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="app-notification-dismiss"
                              aria-label={`Mark ${alert.title} as read`}
                              onClick={() =>
                                markReadMutation.mutate({ id: alert.id })
                              }
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="app-popover-footer">
                    <button
                      type="button"
                      className="app-popover-link"
                      onClick={() => navigateToStore("/alerts")}
                    >
                      View all alerts
                    </button>
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
