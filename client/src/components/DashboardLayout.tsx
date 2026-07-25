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
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  Zap,
  CheckCircle,
  Check,
  Globe,
  Brain,
  Shield,
  Settings as SettingsIcon,
  Radar,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import type { User } from "@shared/types";
import { trpc } from "@/lib/trpc";
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
  { icon: SettingsIcon, label: "Settings", path: "/settings", adminOnly: false },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const { data: user, isLoading } = trpc.auth.me.useQuery();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  const { data: products } = trpc.products.list.useQuery(undefined, { enabled: !!user });
  const { data: stores } = trpc.shopify.listStores.useQuery(undefined, { enabled: !!user });
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (!user || isLoading) return false;
    const dismissed = localStorage.getItem("onboarding-dismissed");
    const hasProducts = (products?.length ?? 0) > 0;
    const hasStores = (stores?.length ?? 0) > 0;
    return !dismissed && !hasProducts && !hasStores;
  });

  useEffect(() => {
    if (!user || isLoading) return;
    const dismissed = localStorage.getItem("onboarding-dismissed");
    const hasProducts = (products?.length ?? 0) > 0;
    const hasStores = (stores?.length ?? 0) > 0;
    if (!dismissed && !hasProducts && !hasStores) {
      setOnboardingOpen(true);
    }
  }, [user, isLoading, products, stores]);

  const handleOnboardingComplete = () => {
    localStorage.setItem("onboarding-dismissed", "true");
    setOnboardingOpen(false);
  };

  if (isLoading) return <DashboardLayoutSkeleton />;
  if (!user) return null;

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <OnboardingWizard
        open={onboardingOpen}
        onOpenChange={(open) => {
          setOnboardingOpen(open);
          if (!open) localStorage.setItem("onboarding-dismissed", "true");
        }}
        onComplete={handleOnboardingComplete}
      />
      <DashboardLayoutContent user={user} setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  user: User;
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  user,
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
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
  const { data: allProducts } = trpc.products.list.useQuery();
  const handleExport = useCallback(() => {
    const products = allProducts ?? [];
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
  }, [allProducts]);

  // ── Sync Shopify handler ──
  const { data: stores } = trpc.shopify.listStores.useQuery();
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
    const activeStore = stores.find((s: { isActive: boolean }) => s.isActive);
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
    trpc.alerts.list.useQuery(
      { unreadOnly: true, limit: 10 }
    );

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
  const criticalCount = alertStats?.critical ?? 0;
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

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const w = e.clientX - left;
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setSidebarWidth(w);
    };
    const onUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/auth";
    },
  });

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-sidebar-border bg-sidebar"
          disableTransition={isResizing}
        >
          {/* Header */}
          <SidebarHeader className="h-14 justify-center border-b border-white/[0.04]">
            <div className="flex items-center gap-3 px-4 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-white/[0.06] hover:text-primary rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-7 w-7 rounded bg-primary/15 flex items-center justify-center">
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
          <SidebarContent className="gap-0 px-3 py-4">
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
                        className={`h-10 transition-all rounded ${
                          isActive
                            ? "text-primary font-bold border-r-2 border-primary bg-primary/[0.08]"
                            : "text-muted-foreground hover:bg-white/[0.04] font-normal"
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
          <SidebarFooter className="p-3 border-t border-white/[0.04] space-y-1">
            {switchable && (
              <button
                onClick={toggleTheme}
                className="flex items-center gap-2 w-full rounded px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors text-muted-foreground"
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
                <button className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/[0.04] transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8 border border-outline-variant shrink-0">
                    <AvatarFallback className="text-xs font-bold bg-primary/12 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
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
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (!isCollapsed) setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      {/* Main */}
      <SidebarInset>
        {/* Top bar */}
        <div className="flex border-b border-white/[0.04] h-14 items-center justify-between bg-background/80 backdrop-blur-md px-6 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            {isMobile && <SidebarTrigger className="h-9 w-9" />}
            {!isMobile && (
              <>
                {/* Search */}
                <div className="relative" ref={searchContainerRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    name="search"
                    className="bg-surface-container-low border border-outline-variant rounded pl-9 pr-4 py-1.5 text-sm font-mono focus:outline-none focus:border-primary w-64 transition-all placeholder:text-muted-foreground/50"
                    placeholder="Search insights..."
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

                <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="label-caps text-[10px] text-muted-foreground">
                    Last Sync: 2m ago
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 border border-primary/30 text-primary label-caps text-[11px] hover:bg-primary/[0.08] transition-all active:scale-95 rounded"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              EXPORT DATA
            </button>
            <button
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground font-bold label-caps text-[11px] hover:brightness-110 transition-all active:scale-95 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
            <button className="p-2 text-muted-foreground hover:text-primary transition-colors rounded hover:bg-white/[0.04]">
              <RefreshCw className="h-4 w-4" />
            </button>
            {/* Notification bell */}
            <div className="relative" ref={notifContainerRef}>
              <button
                className="p-2 text-muted-foreground hover:text-primary transition-colors rounded hover:bg-white/[0.04] relative"
                onClick={() => setNotifOpen(!notifOpen)}
                aria-label="Notifications"
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
                <div className="absolute right-0 top-full mt-1 w-96 bg-card border border-outline-variant rounded-lg shadow-xl overflow-hidden z-50">
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
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
