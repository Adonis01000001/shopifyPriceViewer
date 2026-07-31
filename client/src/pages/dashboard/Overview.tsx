import { Badge } from "@/components/ui/badge";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  DollarSign,
  LineChart,
  Package,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { PricingDashboardSummary } from "@/components/dashboard/PricingRecommendationWidget";
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
  const utils = trpc.useUtils();
  const { data: products } = trpc.products.list.useQuery();
  const { data: productStats } = trpc.products.stats.useQuery();
  const { data: competitorStats } = trpc.competitors.stats.useQuery();
  const { data: alertStats } = trpc.alerts.stats.useQuery();
  const { data: competitors } = trpc.competitors.list.useQuery({ limit: 10 });
  const { data: user } = trpc.auth.me.useQuery();
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
      toast.success("Pricing insight approved");
    },
  });
  const dismissRecommendation = trpc.recommendations.dismiss.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.stats.invalidate();
      toast.success("Pricing insight dismissed");
    },
  });
  const markAlertRead = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      utils.alerts.stats.invalidate();
    },
  });

  const generateRecommendation = trpc.recommendations.generate.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.listAll.invalidate();
      toast.success("Recommendation generated");
    },
    onError: (err) => toast.error(err.message || "Failed to generate"),
  });

  // Fetch feed data for each competitor
  const competitorList = useMemo(() => competitors ?? [], [competitors]);
  const feedQueries = trpc.useQueries(t =>
    competitorList.map(comp =>
      t.competitors.feed({ competitorId: comp.id }, { enabled: !!comp.id })
    )
  );

  // Build movement items from all competitor feeds
  const movementItems = useMemo(() => {
    const items: {
      id: string;
      type: "price_drop" | "price_increase" | "new_match";
      competitorName: string;
      productTitle: string;
      oldPrice?: string;
      newPrice: string;
      date: Date;
    }[] = [];

    feedQueries.forEach((q, idx) => {
      const feed = q.data;
      if (!feed) return;
      const compName = competitorList[idx]?.name ?? "Unknown";

      // Price changes from competitor products
      for (const cp of feed.products ?? []) {
        const hasPrevious =
          cp.previousPrice != null && cp.previousPrice !== cp.price;
        if (hasPrevious) {
          const direction =
            Number(cp.price) < Number(cp.previousPrice)
              ? "price_drop"
              : "price_increase";
          items.push({
            id: `cp-${cp.id}`,
            type: direction,
            competitorName: compName,
            productTitle: cp.competitorProductTitle || "Untitled",
            oldPrice: String(cp.previousPrice),
            newPrice: String(cp.price),
            date: cp.lastPriceUpdate
              ? new Date(cp.lastPriceUpdate)
              : new Date(cp.updatedAt),
          });
        } else {
          items.push({
            id: `cp-${cp.id}`,
            type: "new_match",
            competitorName: compName,
            productTitle: cp.competitorProductTitle || "Untitled",
            newPrice: String(cp.price),
            date: new Date(cp.createdAt),
          });
        }
      }

      // Price history entries
      for (const ph of feed.priceHistory ?? []) {
        items.push({
          id: `ph-${ph.id}`,
          type: "price_drop",
          competitorName: compName,
          productTitle: `Price recorded`,
          newPrice: String(ph.price),
          date: new Date(ph.recordedAt),
        });
      }
    });

    // Sort by date descending, take top 12
    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    return items.slice(0, 12);
  }, [feedQueries, competitorList]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Overview</h2>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Strategic dashboard for Shopify store intelligence. Real-time pricing
          index and competitive landscape monitoring.
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-card p-5 flex flex-col gap-3">
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
        <div className="glass-card p-5 flex flex-col gap-3">
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
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-primary" />
            <span className="text-xs font-mono text-primary">+5.2%</span>
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
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
        <div className="glass-card p-5 flex flex-col gap-3">
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
            <span className="text-xs font-mono">All stable</span>
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
                              <p className="text-[13px] font-medium">{product.title ?? "Untitled"}</p>
                              <p className="text-[10px] label-caps text-muted-foreground">{product.sku || product.category || "No SKU"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 font-mono text-[13px] font-medium">
                          ${Number(product.price).toFixed(2)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[13px] text-muted-foreground">—</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[13px] text-muted-foreground">—</span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end">
                            <button
                              className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold label-caps rounded hover:bg-primary/20 disabled:opacity-50"
                              onClick={() => generateRecommendation.mutate({ productId: product.id })}
                              disabled={generateRecommendation.isPending}
                            >
                              {generateRecommendation.isPending ? "..." : "GENERATE"}
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
                        No products yet. Add products to start tracking pricing insights.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-white/[0.04] text-center">
              <button
                className="text-primary label-caps text-[11px] hover:underline"
                onClick={() => window.location.href = "/products"}
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
              {competitorList.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <p className="font-medium mb-1">No competitors yet</p>
                  <p className="text-xs">
                    Add competitors to see their price movements here.
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
        <div className="glass-card p-5 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-[14px] font-semibold">Inventory Sync Status</h4>
            <CheckCircle className="h-4 w-4 text-primary" />
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-[12px] text-muted-foreground">
                  Primary Shopify API
                </span>
                <span className="text-[11px] font-mono text-primary">
                  HEALTHY (12ms)
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full w-full" />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-[12px] text-muted-foreground">
                  Scraping Cluster
                </span>
                <span className="text-[11px] font-mono text-[#21a732]">
                  DEGRADED (240ms)
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-[#63e063] rounded-full w-[65%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <span className="text-[12px] text-muted-foreground">
                  Price Index Engine
                </span>
                <span className="text-[11px] font-mono text-primary">
                  OPTIMAL (8ms)
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full w-[92%]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
