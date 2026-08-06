import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  PanelLeft,
  RefreshCw,
  Search,
  Sun,
  Users,
  Download,
  Store,
  X,
  Loader2,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  Zap,
  CheckCircle,
  Check,
  Globe,
  Brain,
  Settings as SettingsIcon,
  Radar,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import type { PublicUser } from "@shared/types";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import OnboardingWizard from "./dashboard/OnboardingWizard";
import { useTheme } from "@/contexts/ThemeContext";
import Papa from "papaparse";
import { toast } from "sonner";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/", adminOnly: false },
  { icon: Package, label: "Products", path: "/products", adminOnly: false },
  { icon: Globe, label: "Price Scout", path: "/scout", adminOnly: false },
  { icon: Brain, label: "Path of Wisdom", path: "/wisdom", adminOnly: false },
  { icon: Radar, label: "Price Radar", path: "/price-radar", adminOnly: false },
  { icon: Users, label: "Competitors", path: "/competitors", adminOnly: false },
  { icon: BarChart3, label: "Analytics", path: "/analytics", adminOnly: false },
  { icon: Bell, label: "Alerts", path: "/alerts", adminOnly: false },
  {
    icon: SettingsIcon,
    label: "Settings",
    path: "/settings",
    adminOnly: false,
  },
];

const SIDEBAR_WIDTH = "260px";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: user, isLoading } = trpc.auth.me.useQuery();

  const { data: products } = trpc.products.list.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: stores } = trpc.shopify.listStores.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: competitorCount } = trpc.competitors.count.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (!user || isLoading) return false;
    const dismissed = localStorage.getItem("onboarding-dismissed");
    const hasProducts = (products?.length ?? 0) > 0;
    const hasStores = (stores?.length ?? 0) > 0;
    const hasCompetitors = (competitorCount ?? 0) > 0;
    return !dismissed && !(hasProducts && hasStores && hasCompetitors);
  });

  useEffect(() => {
    if (!user || isLoading) return;
    const dismissed = localStorage.getItem("onboarding-dismissed");
    const hasProducts = (products?.length ?? 0) > 0;
    const hasStores = (stores?.length ?? 0) > 0;
    const hasCompetitors = (competitorCount ?? 0) > 0;
    if (!dismissed && !(hasProducts && hasStores && hasCompetitors)) {
      setOnboardingOpen(true);
    }
  }, [user, isLoading, products, stores, competitorCount]);

  const handleOnboardingComplete = () => {
    localStorage.setItem("onboarding-dismissed", "true");
    setOnboardingOpen(false);
  };

  if (isLoading) return <DashboardLayoutSkeleton />;
  if (!user) return null;

  return (
    <SidebarProvider
      style={{ "--sidebar-width": SIDEBAR_WIDTH } as CSSProperties}
    >
      <OnboardingWizard
        open={onboardingOpen}
        stores={stores ?? []}
        productCount={products?.length ?? 0}
        competitorCount={competitorCount ?? 0}
        onOpenChange={open => {
          setOnboardingOpen(open);
        }}
        onComplete={handleOnboardingComplete}
      />
      <DashboardLayoutContent
        user={user}
        products={products ?? []}
        stores={stores ?? []}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  user: PublicUser;
  products: RouterOutputs["products"]["list"];
  stores: RouterOutputs["shopify"]["listStores"];
  children: React.ReactNode;
};

function DashboardLayoutContent({
  user,
  products,
  stores,
  children,
}: DashboardLayoutContentProps) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const { theme, toggleTheme, switchable } = useTheme();
  useRealtimeNotifications();

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const productSearch = trpc.products.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );
  const competitorSearch = trpc.competitors.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );

  const searchResults = {
    products: productSearch.data ?? [],
    competitors: competitorSearch.data ?? [],
    loading: productSearch.isLoading || competitorSearch.isLoading,
    hasResults:
      (productSearch.data?.length ?? 0) > 0 ||
      (competitorSearch.data?.length ?? 0) > 0,
  };

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Export handler ──
  const handleExport = useCallback(() => {
    if (!products.length) {
      toast.error("No products to export");
      return;
    }
    const rows = products.map(p => ({
      Title: p.title,
      SKU: p.sku ?? "",
      Category: p.category ?? "",
      Price: Number(p.price).toFixed(2),
      "Compare At": p.compareAtPrice ? Number(p.compareAtPrice).toFixed(2) : "",
      Status: p.status,
      Vendor: p.vendor ?? "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `priceintel-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${products.length} products`);
  }, [products]);

  // ── Sync Shopify handler ──
  const syncMutation = trpc.shopify.syncProducts.useMutation({
    onSuccess: data => {
      toast.success(data.message || `Synced ${data.synced} products`);
    },
    onError: err => {
      toast.error(err.message || "Sync failed");
    },
  });

  const handleSyncShopify = useCallback(() => {
    if (!stores || stores.length === 0) {
      toast.error("No Shopify store connected", {
        description: "Go to Settings to connect your store first.",
      });
      return;
    }
    const activeStore = stores.find(s => s.isActive);
    if (!activeStore) {
      toast.error("No active Shopify store found");
      return;
    }
    syncMutation.mutate({ storeId: activeStore.id });
  }, [stores, syncMutation]);

  // ── Notification state ──
  const [notifOpen, setNotifOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement>(null);

  const { data: alertStats } = trpc.alerts.stats.useQuery();
  const { data: unreadAlerts, refetch: refetchAlerts } =
    trpc.alerts.list.useQuery({ unreadOnly: true, limit: 10 });

  const markReadMutation = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      refetchAlerts();
    },
  });
  const markAllReadMutation = trpc.alerts.markAllRead.useMutation({
    onSuccess: () => {
      refetchAlerts();
    },
  });

  const unreadCount = alertStats?.unread ?? 0;
  const notifItems = unreadAlerts ?? [];

  // Severity + type config for notification items
  const severityConfig: Record<string, { label: string; className: string }> = {
    critical: {
      label: "CRITICAL",
      className: "bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/30",
    },
    high: {
      label: "HIGH",
      className: "bg-[#93000a]/15 text-[#ffb4ab]/80 border-[#ffb4ab]/20",
    },
    medium: {
      label: "MEDIUM",
      className: "bg-[#63e063]/10 text-[#21a732] border-[#63e063]/20",
    },
    low: {
      label: "LOW",
      className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
  };
  const typeIcons: Record<string, typeof TrendingDown> = {
    price_drop: TrendingDown,
    price_increase: TrendingUp,
    competitor_change: ArrowUpDown,
    threshold: Zap,
  };

  // Close notification dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/auth";
    },
  });

  return (
    <>
      <Sidebar collapsible="icon" className="!border-r-0 bg-sidebar/95">
        {/* Header */}
        <SidebarHeader className="min-h-16 justify-center bg-sidebar/80">
          <div className="flex items-center gap-3 px-4 w-full">
            <button
              onClick={toggleSidebar}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
              aria-label="Toggle navigation"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            {!isCollapsed && (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center ring-1 ring-primary/20">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold tracking-tight text-sm text-primary leading-none">
                    PriceIntel
                  </span>
                  <span className="label-caps text-[9px] text-muted-foreground/60 mt-0.5">
                    Shopify Pro Suite
                  </span>
                </div>
              </div>
            )}
          </div>
        </SidebarHeader>

        {/* Nav */}
        <SidebarContent
          aria-label="Primary navigation"
          className="gap-0 px-3 py-5"
        >
          <SidebarMenu>
            {menuItems
              .filter(item => !item.adminOnly || user?.role === "admin")
              .map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 rounded-lg transition-colors ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-foreground font-semibold ring-1 ring-primary/20 shadow-sm"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground font-normal"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="text-[13px]">{item.label}</span>
                      {isActive && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarContent>

        {/* Footer */}
        <SidebarFooter className="space-y-1 bg-sidebar/70 p-3">
          {switchable && (
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-[#63e063]" />
              ) : (
                <Moon className="h-4 w-4 text-primary" />
              )}
              {!isCollapsed && (
                <span className="text-xs">
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </span>
              )}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-sidebar-border hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-8 w-8 border border-outline-variant shrink-0">
                  <AvatarFallback className="text-xs font-bold bg-primary/12 text-primary">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="text-sm font-medium truncate leading-none">
                    {user?.name || "—"}
                  </p>
                  <p className="text-[10px] label-caps text-muted-foreground truncate mt-1">
                    STORE OWNER
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => logoutMutation.mutate()}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Main */}
      <SidebarInset>
        {/* Top bar */}
        <div className="sticky top-0 z-40 flex min-h-16 items-center justify-between bg-background/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            {isMobile && <SidebarTrigger className="h-9 w-9" />}
            {isMobile && (
              <span className="text-sm font-semibold tracking-tight">
                PriceIntel
              </span>
            )}
            {!isMobile && (
              <>
                {/* Search */}
                <div
                  className="relative"
                  ref={searchContainerRef}
                  role="search"
                >
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    name="search"
                    className="h-10 w-64 rounded-lg border border-input bg-surface-container-low pl-9 pr-10 text-sm transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                    placeholder="Search products or competitors"
                    aria-label="Search products or competitors"
                    value={searchQuery}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.length >= 2) setSearchOpen(true);
                      else setSearchOpen(false);
                    }}
                    onFocus={() => {
                      if (searchQuery.length >= 2) setSearchOpen(true);
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* Search dropdown */}
                  {searchOpen && debouncedQuery.length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-outline-variant rounded-lg shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto">
                      {searchResults.loading && (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {!searchResults.loading && !searchResults.hasResults && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No results for &ldquo;{debouncedQuery}&rdquo;
                        </div>
                      )}
                      {searchResults.products.length > 0 && (
                        <div>
                          <div className="px-3 py-1.5 label-caps text-[10px] text-muted-foreground bg-surface-container-high">
                            Products ({searchResults.products.length})
                          </div>
                          {searchResults.products.map(p => (
                            <button
                              type="button"
                              key={p.id}
                              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.04] transition-colors text-left"
                              onClick={() => {
                                setLocation("/products");
                                setSearchOpen(false);
                                setSearchQuery("");
                              }}
                            >
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium truncate">
                                  {p.title}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {p.category || "—"} · $
                                  {Number(p.price).toFixed(2)}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.competitors.length > 0 && (
                        <div>
                          <div className="px-3 py-1.5 label-caps text-[10px] text-muted-foreground bg-surface-container-high border-t border-outline-variant/20">
                            Competitors ({searchResults.competitors.length})
                          </div>
                          {searchResults.competitors.map(c => (
                            <button
                              type="button"
                              key={c.id}
                              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.04] transition-colors text-left"
                              onClick={() => {
                                setLocation("/competitors");
                                setSearchOpen(false);
                                setSearchQuery("");
                              }}
                            >
                              <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium truncate">
                                  {c.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {c.domain}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="hidden xl:flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="label-caps text-[10px] text-primary/80">
                    Workspace live
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="hidden lg:flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-primary label-caps text-[11px] transition-colors hover:bg-primary/[0.08]"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              EXPORT DATA
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground font-bold label-caps text-[11px] transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSyncShopify}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {syncMutation.isPending ? "SYNCING..." : "SYNC SHOPIFY"}
            </button>
            <div className="w-px h-6 bg-outline-variant mx-1" />
            <button
              type="button"
              className="hidden sm:inline-flex rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
              aria-label="Refresh notifications"
              onClick={() => void refetchAlerts()}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {/* Notification bell */}
            <div className="relative" ref={notifContainerRef}>
              <button
                type="button"
                className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                onClick={() => setNotifOpen(!notifOpen)}
                aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-error-container text-[10px] font-bold text-white px-1 border-2 border-background">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification dropdown */}
              {notifOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-outline-variant/30 bg-surface-container/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">
                        Notifications
                      </span>
                      {unreadCount > 0 && (
                        <span className="text-[10px] font-bold bg-error-container/20 text-error-container px-1.5 py-0.5 rounded-full">
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        className="text-[11px] label-caps text-primary hover:underline flex items-center gap-1"
                        onClick={() => markAllReadMutation.mutate()}
                        disabled={markAllReadMutation.isPending}
                      >
                        <Check className="h-3 w-3" />
                        Mark all read
                      </button>
                    )}
                  </div>

                  {/* Alert list */}
                  <div className="max-h-80 overflow-y-auto">
                    {notifItems.length === 0 ? (
                      <div className="py-8 text-center">
                        <CheckCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No new notifications
                        </p>
                        <p className="text-[11px] text-muted-foreground/60">
                          You&apos;re all caught up!
                        </p>
                      </div>
                    ) : (
                      notifItems.map(alert => {
                        const severity =
                          severityConfig[alert.severity] ??
                          severityConfig.medium;
                        const TypeIcon = typeIcons[alert.alertType] ?? Zap;
                        return (
                          <div
                            key={alert.id}
                            className="flex items-start gap-3 px-4 py-3 border-b border-outline-variant/10 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                            onClick={() => {
                              markReadMutation.mutate({ id: alert.id });
                              setLocation("/alerts");
                              setNotifOpen(false);
                            }}
                          >
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${severity.className}`}
                            >
                              <TypeIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="text-[12px] font-medium truncate">
                                  {alert.title}
                                </p>
                                <span
                                  className={`inline-flex items-center rounded px-1 py-0.5 text-[8px] font-bold label-caps shrink-0 ${severity.className}`}
                                >
                                  {severity.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {alert.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground/50 mt-1">
                                {new Date(alert.createdAt).toLocaleString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition-all shrink-0"
                              title="Mark as read"
                              onClick={e => {
                                e.stopPropagation();
                                markReadMutation.mutate({ id: alert.id });
                              }}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-2.5 border-t border-outline-variant/30 bg-surface-container/30 text-center">
                    <button
                      type="button"
                      className="text-[11px] label-caps text-primary hover:underline font-medium"
                      onClick={() => {
                        setLocation("/alerts");
                        setNotifOpen(false);
                      }}
                    >
                      View all alerts →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </>
  );
}
