import { Badge } from "@/components/ui/badge";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle,
  DollarSign,
  LineChart,
  Package,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { PricingDashboardSummary } from "@/components/dashboard/PricingRecommendationWidget";
import { UpgradePrompt } from "@/components/dashboard/UpgradePrompt";
import { useProductAnalytics } from "@/lib/analytics";
import { toast } from "sonner";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Overview() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: products } = trpc.products.list.useQuery();
  const { data: productStats } = trpc.products.stats.useQuery();
  const { data: competitorStats } = trpc.competitors.stats.useQuery();
  const { data: alertStats } = trpc.alerts.stats.useQuery();
  const { data: actionCenter } = trpc.intelligence.actionCenter.useQuery();
  const { data: accountUsage } = trpc.account.usage.useQuery();
  const { data: user } = trpc.auth.me.useQuery();
  const track = useProductAnalytics();
  const firstValueTracked = useRef(false);
  const dashboardViewTracked = useRef(false);
  const isAdmin = user?.role === "admin";
  // Admins see all pending recommendations; regular users see only their own
  const adminQuery = trpc.recommendations.listAll.useQuery(
    { status: "pending", limit: 200 },
    { enabled: isAdmin }
  );
  const userQuery = trpc.recommendations.list.useQuery(
    { status: "pending", limit: 6 },
    { enabled: !isAdmin }
  );
  const recommendations = isAdmin
    ? (adminQuery.data ?? [])
    : (userQuery.data ?? []);
  const { data: notifications } = trpc.alerts.list.useQuery({
    unreadOnly: true,
    limit: 6,
  });
  const implementRecommendation = trpc.recommendations.implement.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.stats.invalidate();
      utils.products.list.invalidate();
      utils.intelligence.actionCenter.invalidate();
      toast.success("Pricing insight approved");
    },
  });
  const dismissRecommendation = trpc.recommendations.dismiss.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.stats.invalidate();
      utils.intelligence.actionCenter.invalidate();
      toast.success("Pricing insight dismissed");
    },
  });
  const markAlertRead = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      utils.alerts.stats.invalidate();
      utils.intelligence.actionCenter.invalidate();
    },
  });

  const generateRecommendation = trpc.recommendations.generate.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.listAll.invalidate();
      utils.intelligence.actionCenter.invalidate();
      toast.success("Recommendation generated");
    },
    onError: err => toast.error(err.message || "Failed to generate"),
  });

  // Build movement items from the tenant-scoped Action Center query.
  const movementItems = useMemo(() => {
    return (actionCenter?.recentChanges ?? []).map(change => ({
      id: change.id,
      type:
        change.changeType === "price_decrease"
          ? ("price_drop" as const)
          : change.changeType === "price_increase"
            ? ("price_increase" as const)
            : ("new_match" as const),
      competitorName: change.competitorName,
      productTitle: change.productTitle,
      oldPrice: change.previousPrice ?? undefined,
      newPrice: change.newPrice ?? "0",
      date: new Date(change.detectedAt),
    }));
  }, [actionCenter?.recentChanges]);

  const allProducts = useMemo(() => products ?? [], [products]);
  const productById = useMemo(
    () => new Map(allProducts.map(product => [product.id, product])),
    [allProducts]
  );
  const pricingInsights = recommendations ?? [];
  const notificationItems = notifications ?? [];

  const categoryData = useMemo(() => {
    if (!allProducts.length) return [];
    const cats: Record<string, number> = {};
    for (const p of allProducts) {
      const c = p.category || "Uncategorized";
      cats[c] = (cats[c] || 0) + 1;
    }
    const total = allProducts.length;
    const entries = Object.entries(cats);
    if (!entries.length) return [];
    const raw = entries.map(([name, count]) => {
      const e = (count / total) * 100;
      return { name, exact: e, floor: Math.floor(e) };
    });
    const sum = raw.reduce((s, e) => s + e.floor, 0);
    const rem = 100 - sum;
    const sorted = raw
      .map((e, i) => ({ ...e, index: i, frac: e.exact - e.floor }))
      .sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < rem; i++) sorted[i % sorted.length].floor += 1;
    return sorted.map(({ name, floor }, i) => ({
      name,
      value: floor ?? 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [allProducts]);

  const totalProducts = productStats?.total ?? 0;
  const avgPrice = productStats?.avgPrice
    ? Number(productStats.avgPrice).toFixed(2)
    : "0.00";
  const activeAlerts = alertStats?.unread ?? 0;
  const competitorsTracked = competitorStats?.total ?? 0;
  const changesLast24Hours = actionCenter?.totals.changesLast24Hours ?? 0;
  const topRecommendation = actionCenter?.pendingRecommendations[0];
  const topAlert = actionCenter?.unreadAlerts[0];
  const topMovement = actionCenter?.recentChanges[0];
  const showAiUpgrade = accountUsage?.plan.id === "free";

  useEffect(() => {
    if (dashboardViewTracked.current) return;
    dashboardViewTracked.current = true;
    track("dashboard_viewed", { surface: "overview" });
  }, [track]);

  useEffect(() => {
    if (
      firstValueTracked.current ||
      !actionCenter ||
      (actionCenter.totals.pendingRecommendations === 0 &&
        actionCenter.totals.unreadAlerts === 0 &&
        actionCenter.totals.changesLast24Hours === 0)
    ) {
      return;
    }
    firstValueTracked.current = true;
    track("first_value_reached", {
      activation_path: "dashboard_action_center",
      signal_type: topRecommendation
        ? "recommendation"
        : topAlert
          ? "alert"
          : "competitor_movement",
    });
  }, [actionCenter, topAlert, topRecommendation, track]);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div>
          <p className="page-kicker">Decision workspace</p>
          <h2 className="page-title">Overview</h2>
          <p className="page-description">
            See what changed, what matters, and which pricing decision deserves
            your attention next.
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Monitoring active
        </div>
      </div>

      {/* Merchant-first action center: one obvious decision before the metrics. */}
      <section className="glass-panel rounded-xl border-primary/25 bg-primary/[0.06] p-5 shadow-[0_18px_50px_-36px_var(--primary)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-2 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="label-caps text-[10px] text-primary">
                NEXT BEST ACTION
              </p>
              <h3 className="mt-1 text-sm font-semibold">
                {topRecommendation
                  ? `Review ${topRecommendation.productTitle}`
                  : topAlert
                    ? topAlert.title
                    : topMovement
                      ? `${topMovement.competitorName} moved on ${topMovement.productTitle}`
                      : totalProducts === 0
                        ? "Connect your store to get your first pricing signal"
                        : "Your pricing workspace is ready for a competitor scan"}
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                {topRecommendation
                  ? `${topRecommendation.reason} ${Number(topRecommendation.currentPrice).toFixed(2)} → ${Number(topRecommendation.recommendedPrice).toFixed(2)}.`
                  : topAlert
                    ? topAlert.message
                    : topMovement
                      ? `Detected ${changesLast24Hours} competitor movement${changesLast24Hours === 1 ? "" : "s"} in the last 24 hours.`
                      : "Add a competitor and we’ll surface the price changes that deserve your attention."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground transition hover:brightness-110"
            onClick={() =>
              setLocation(
                topRecommendation
                  ? "/products"
                  : topAlert
                    ? "/alerts"
                    : topMovement
                      ? "/competitors"
                      : "/products"
              )
            }
          >
            {topRecommendation
              ? "Review recommendation"
              : topAlert
                ? "Open alerts"
                : topMovement
                  ? "Review movement"
                  : "Open products"}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>

      {showAiUpgrade && (
        <UpgradePrompt
          feature="ai_recommendations"
          plan="Pro"
          title="Turn competitor movement into a price decision"
          description="Pro explains why a product should move, shows the evidence behind the recommendation, and keeps the decision in your hands."
          metric="Value signal: fewer spreadsheet checks and faster pricing reviews."
        />
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card flex flex-col gap-3 p-5">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">
              Total Products
            </span>
            <div className="bg-primary/[0.12] p-1.5 rounded">
              <Package className="h-5 w-5 text-primary" />
            </div>
          </div>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">
            {totalProducts.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground/60">
            Across all categories
          </p>
        </div>
        <div className="glass-card flex flex-col gap-3 p-5">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">
              Avg. Price
            </span>
            <div className="bg-[var(--color-tertiary,#21a732)]/15 p-1.5 rounded">
              <DollarSign className="h-5 w-5 text-[var(--color-tertiary,#21a732)]" />
            </div>
          </div>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">
            ${avgPrice}
          </p>
          <p className="text-xs text-muted-foreground/60">Portfolio average</p>
        </div>
        <div className="glass-card flex flex-col gap-3 p-5">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">
              Active Alerts
            </span>
            <div className="bg-[#93000a]/15 p-1.5 rounded">
              <AlertTriangle className="h-5 w-5 text-[#ffb4ab]" />
            </div>
          </div>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">
            {activeAlerts}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {alertStats?.critical ?? 0} critical
          </p>
        </div>
        <div className="glass-card flex flex-col gap-3 p-5">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">
              Competitors
            </span>
            <div className="bg-[var(--color-secondary,#c0c1ff)]/15 p-1.5 rounded">
              <Users className="h-5 w-5 text-[var(--color-secondary,#c0c1ff)]" />
            </div>
          </div>
          <p className="text-2xl font-bold font-mono tracking-tight leading-none">
            {competitorsTracked}
          </p>
          <div className="flex items-center gap-1 text-primary">
            <CheckCircle className="h-3 w-3" />
            <span className="text-xs font-mono">
              {changesLast24Hours > 0
                ? `${changesLast24Hours} movement${changesLast24Hours === 1 ? "" : "s"} today`
                : "No movements in 24h"}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing Position Summary */}
      <PricingDashboardSummary />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Pricing Insights */}
        <div className="lg:col-span-8">
          <div className="glass-panel rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <LineChart className="h-4 w-4 text-primary" />
                <h3 className="text-[15px] font-semibold">Pricing Insights</h3>
              </div>
              <span className="label-caps text-[10px] bg-[var(--color-secondary,#c0c1ff)]/20 text-[var(--color-secondary,#c0c1ff)] px-2 py-0.5 rounded border border-[var(--color-secondary,#c0c1ff)]/20">
                AI POWERED
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container/30 border-b border-white/[0.04] label-caps text-muted-foreground">
                    <th className="px-5 py-3 font-normal">Product</th>
                    <th className="px-5 py-3 font-normal">Current</th>
                    <th className="px-5 py-3 font-normal">Target</th>
                    <th className="px-5 py-3 font-normal">Impact</th>
                    <th className="px-5 py-3 font-normal text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {pricingInsights.length > 0 ? (
                    pricingInsights.map(insight => {
                      const product = productById.get(insight.productId);
                      const currentPrice = Number(insight.currentPrice);
                      const recommendedPrice = Number(insight.recommendedPrice);
                      const priceChange = Number(insight.priceChange);
                      const confidence = Math.round(
                        Number(insight.confidenceScore) * 100
                      );
                      return (
                        <tr
                          key={insight.id}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-xs font-bold text-muted-foreground">
                                {(product?.title ?? "P").charAt(0)}
                              </div>
                              <div>
                                <p className="text-[13px] font-medium">
                                  {product?.title ?? "Tracked product"}
                                </p>
                                <p className="text-[10px] label-caps text-muted-foreground">
                                  {product?.sku || `${confidence}% confidence`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono text-[13px] font-medium">
                            ${currentPrice.toFixed(2)}
                          </td>
                          <td className="px-5 py-3">
                            <span className="font-mono text-[13px] font-medium text-primary">
                              ${recommendedPrice.toFixed(2)}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "px-5 py-3 font-mono text-[13px] font-medium",
                              priceChange < 0
                                ? "text-[#ffb4ab]"
                                : "text-primary"
                            )}
                          >
                            {priceChange >= 0 ? "+" : ""}$
                            {priceChange.toFixed(2)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                className="p-1.5 hover:bg-[#93000a]/20 text-muted-foreground hover:text-[#ffb4ab] rounded text-sm disabled:opacity-50"
                                onClick={() =>
                                  dismissRecommendation.mutate({
                                    id: insight.id,
                                  })
                                }
                                disabled={
                                  dismissRecommendation.isPending ||
                                  implementRecommendation.isPending
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                                {"×"}
                              </button>
                              <button
                                className="px-3 py-1 bg-primary text-primary-foreground text-[10px] font-bold label-caps rounded hover:brightness-110 disabled:opacity-50"
                                onClick={() =>
                                  implementRecommendation.mutate({
                                    id: insight.id,
                                  })
                                }
                                disabled={
                                  dismissRecommendation.isPending ||
                                  implementRecommendation.isPending
                                }
                              >
                                APPROVE
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : allProducts.length > 0 ? (
                    allProducts.slice(0, 10).map(product => (
                      <tr
                        key={product.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-xs font-bold text-muted-foreground">
                              {(product.title ?? "P").charAt(0)}
                            </div>
                            <div>
                              <p className="text-[13px] font-medium">
                                {product.title ?? "Untitled"}
                              </p>
                              <p className="text-[10px] label-caps text-muted-foreground">
                                {product.sku || product.category || "No SKU"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 font-mono text-[13px] font-medium">
                          ${Number(product.price).toFixed(2)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[13px] text-muted-foreground">
                            —
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[13px] text-muted-foreground">
                            —
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end">
                            <button
                              className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold label-caps rounded hover:bg-primary/20 disabled:opacity-50"
                              onClick={() =>
                                generateRecommendation.mutate({
                                  productId: product.id,
                                })
                              }
                              disabled={generateRecommendation.isPending}
                            >
                              {generateRecommendation.isPending
                                ? "..."
                                : "GENERATE"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-muted-foreground text-sm"
                      >
                        No products yet. Add products to start tracking pricing
                        insights.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-white/[0.04] text-center">
              <button
                className="text-primary label-caps text-[11px] hover:underline"
                onClick={() => (window.location.href = "/products")}
              >
                VIEW ALL RECOMMENDATIONS
              </button>
            </div>
          </div>
        </div>

        {/* Competitor Movement Feed */}
        <div className="lg:col-span-4">
          <div className="glass-panel rounded-lg flex flex-col h-full">
            <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-3">
              <RefreshCw className="h-4 w-4 text-[#21a732]" />
              <h3 className="text-[15px] font-semibold">Competitor Movement</h3>
            </div>
            <div className="p-3">
              {movementItems.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <p className="font-medium mb-1">No recent movements</p>
                  <p className="text-xs">
                    Movements will appear here as monitored competitors change
                    price.
                  </p>
                </div>
              ) : movementItems.length > 0 ? (
                <div className="space-y-0.5 max-h-[320px] overflow-y-auto">
                  {movementItems.map(item => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[0.02] transition-colors"
                    >
                      <div
                        className={cn(
                          "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          item.type === "price_drop"
                            ? "bg-primary/[0.12]"
                            : item.type === "price_increase"
                              ? "bg-[#93000a]/15"
                              : "bg-[var(--color-secondary,#c0c1ff)]/15"
                        )}
                      >
                        {item.type === "price_drop" ? (
                          <TrendingDown className="h-3.5 w-3.5 text-primary" />
                        ) : item.type === "price_increase" ? (
                          <TrendingUp className="h-3.5 w-3.5 text-[#ffb4ab]" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 text-[var(--color-secondary,#c0c1ff)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium truncate leading-tight">
                          {item.productTitle}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                          <span className="text-muted-foreground/70">
                            {item.competitorName}
                          </span>
                          {item.oldPrice && (
                            <>
                              {" · "}
                              <span className="font-mono text-[10px]">
                                ${Number(item.oldPrice).toFixed(2)}
                              </span>{" "}
                              →
                            </>
                          )}{" "}
                          <span
                            className={cn(
                              "font-mono text-[10px] font-medium",
                              item.type === "price_drop"
                                ? "text-primary"
                                : item.type === "price_increase"
                                  ? "text-[#ffb4ab]"
                                  : ""
                            )}
                          >
                            ${Number(item.newPrice).toFixed(2)}
                          </span>
                        </p>
                      </div>
                      <span className="text-[9px] text-muted-foreground/50 shrink-0 mt-0.5">
                        {timeAgo(item.date)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-muted-foreground text-xs text-center">
                  <RefreshCw className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p>Monitoring for price changes...</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/60">
                    Movements will appear when competitors update prices.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-4 w-4 text-[#ffb4ab]" />
            <h3 className="text-[15px] font-semibold">Notifications</h3>
          </div>
          {notificationItems.length > 0 && (
            <span className="label-caps text-[10px] bg-[#93000a]/15 text-[#ffb4ab] px-2 py-0.5 rounded border border-[#93000a]/20">
              {notificationItems.length} unread
            </span>
          )}
        </div>
        {notificationItems.length > 0 ? (
          <div className="divide-y divide-white/[0.03]">
            {notificationItems.map(alert => (
              <div
                key={alert.id}
                className="px-5 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
              >
                <div
                  className={cn(
                    "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    alert.severity === "critical" || alert.severity === "high"
                      ? "bg-[#93000a]/15"
                      : "bg-primary/[0.12]"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4",
                      alert.severity === "critical" || alert.severity === "high"
                        ? "text-[#ffb4ab]"
                        : "text-primary"
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium truncate">
                      {alert.title}
                    </p>
                    <Badge
                      className={cn(
                        "label-caps text-[9px] border",
                        alert.severity === "critical"
                          ? "bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/30"
                          : alert.severity === "high"
                            ? "bg-[#93000a]/15 text-[#ffb4ab]/80 border-[#ffb4ab]/20"
                            : alert.severity === "medium"
                              ? "bg-[#63e063]/10 text-[#21a732] border-[#63e063]/20"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      )}
                    >
                      {alert.severity}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                    {alert.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {timeAgo(alert.createdAt)}
                  </p>
                </div>
                <button
                  className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/[0.08] disabled:opacity-50"
                  onClick={() => markAlertRead.mutate({ id: alert.id })}
                  disabled={markAlertRead.isPending}
                  title="Mark as read"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No unread notifications right now.
          </div>
        )}
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-5 rounded-lg">
          <h4 className="text-[14px] font-semibold mb-4">Category Mix</h4>
          {categoryData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {categoryData.map((e, i) => (
                      <Cell key={i} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {categoryData.map(c => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="text-muted-foreground">{c.name}</span>
                    </div>
                    <span className="font-medium">{c.value}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
              No categories yet
            </div>
          )}
        </div>
        <div className="glass-card rounded-lg p-5">
          <h4 className="text-[14px] font-semibold mb-4">Decision hygiene</h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Recommendations are suggestions, not automatic price changes. Review
            the evidence and approve only the products that fit your margin and
            inventory strategy.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold label-caps text-primary hover:underline"
            onClick={() => setLocation("/products")}
          >
            Review product controls
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
