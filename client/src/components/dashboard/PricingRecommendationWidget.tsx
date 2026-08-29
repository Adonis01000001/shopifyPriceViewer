import { useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useShopContext } from "@/contexts/ShopContext";
import { cn } from "@/lib/utils";
import {
  TrendingDown,
  TrendingUp,
  Shield,
  DollarSign,
  Target,
  BarChart3,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
  leading: number;
  competitive: number;
  overpriced: number;
  insufficientData: number;
  marginProtection: number;
  total: number;
}

// ─── Pricing Recommendation Widget (per-product) ─────────────────────────────

interface PricingRecommendationWidgetProps {
  productId: string;
}

export function PricingRecommendationWidget({
  productId,
}: PricingRecommendationWidgetProps) {
  const { selectedShopId } = useShopContext();
  const {
    data: ensuredAnalysis,
    isError: hasEnsureError,
    isPending: isEnsuringAnalysis,
    mutate: ensureAnalysis,
  } = trpc.pricingEngine.ensureAnalysis.useMutation();
  const generateMutation =
    trpc.pricingEngine.generateRecommendation.useMutation();

  useEffect(() => {
    if (productId && !ensuredAnalysis) {
      ensureAnalysis({ productId, storeId: selectedShopId ?? undefined });
    }
  }, [ensureAnalysis, ensuredAnalysis, productId, selectedShopId]);

  const result = ensuredAnalysis;
  const snapshot = result?.marketSnapshot ?? null;
  const recommendation = result?.recommendation ?? null;
  const position = result?.position ?? null;

  const stats = useMemo(() => {
    if (!snapshot) return null;
    return {
      avgCompetitor:
        snapshot.avgCompetitorPrice != null
          ? `$${snapshot.avgCompetitorPrice.toFixed(2)}`
          : "—",
      lowestCompetitor:
        snapshot.lowestCompetitorPrice != null
          ? `$${snapshot.lowestCompetitorPrice.toFixed(2)}`
          : "—",
      highestCompetitor:
        snapshot.highestCompetitorPrice != null
          ? `$${snapshot.highestCompetitorPrice.toFixed(2)}`
          : "—",
      competitorCount: snapshot.competitorCount,
    };
  }, [snapshot]);

  if (isEnsuringAnalysis) {
    return (
      <div className="glass-panel rounded-lg p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-surface-container-highest rounded w-1/3" />
          <div className="h-8 bg-surface-container-highest rounded" />
          <div className="h-4 bg-surface-container-highest rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (hasEnsureError) {
    return (
      <div className="glass-panel rounded-lg p-5 text-center text-muted-foreground text-sm">
        Failed to load pricing analysis.
      </div>
    );
  }

  if (!result) {
    return (
      <div className="glass-panel rounded-lg p-5 text-center text-muted-foreground text-sm">
        No data yet.
      </div>
    );
  }

  const suggested = recommendation?.recommendedPrice ?? null;
  const yours = snapshot?.merchantPrice ?? 0;
  const floor = recommendation?.minimumAllowedPrice ?? 0;
  const direction =
    suggested == null || Math.abs(suggested - yours) < 0.01
      ? "hold"
      : suggested < yours
        ? "cut"
        : "rise";

  return (
    <div className="space-y-4">
      {/* What you charge, and what everyone else does */}
      <div className="glass-panel overflow-hidden rounded-lg">
        <div className="flex items-center gap-2 bg-surface-container/50 px-5 py-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold">The prices we found</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <div className="glass-card rounded p-3">
            <p className="text-[13px] text-muted-foreground">You charge</p>
            <p className="mt-1 font-mono text-lg font-bold">
              ${yours.toFixed(2)}
            </p>
          </div>
          <div className="glass-card rounded p-3">
            <p className="text-[13px] text-muted-foreground">
              They charge, on average
            </p>
            <p className="mt-1 font-mono text-lg font-bold">
              {stats?.avgCompetitor}
            </p>
          </div>
          {stats != null && stats.competitorCount > 1 && (
            <>
              <div className="glass-card rounded p-3">
                <p className="text-[13px] text-muted-foreground">
                  Cheapest of them
                </p>
                <p className="mt-1 font-mono text-[14px] text-[var(--success)]">
                  {stats.lowestCompetitor}
                </p>
              </div>
              <div className="glass-card rounded p-3">
                <p className="text-[13px] text-muted-foreground">
                  Dearest of them
                </p>
                <p className="mt-1 font-mono text-[14px] text-[var(--destructive)]">
                  {stats.highestCompetitor}
                </p>
              </div>
            </>
          )}
        </div>
        <div className="px-4 pb-3">
          <p className="text-[13px] text-muted-foreground">
            {stats?.competitorCount === 0
              ? "No shop has been confirmed as selling this."
              : stats?.competitorCount === 1
                ? "From one shop, so treat it carefully. The full list is below."
                : `From ${stats?.competitorCount} shops. The full list is below.`}
          </p>
        </div>
      </div>

      {/* What to do about it */}
      <div className="glass-panel overflow-hidden rounded-lg">
        <div className="flex items-center gap-2 bg-surface-container/50 px-5 py-3">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold">What we suggest</h3>
        </div>
        <div className="space-y-3 p-4">
          <p className="font-mono text-2xl font-bold text-primary">
            {suggested != null ? `$${suggested.toFixed(2)}` : "—"}
          </p>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            {suggested == null ? (
              "Nothing to suggest until we find a shop selling this."
            ) : recommendation?.marginProtectionApplied ? (
              <>
                Your cost sets this one, not the market. Following the shops
                above would take you under the margin you asked us to keep, so
                this is the lowest we will go.
              </>
            ) : direction === "hold" ? (
              <>Your price already sits where the market is.</>
            ) : direction === "cut" ? (
              <>
                Slightly under what the shops above charge, which is where your
                rules aim.
              </>
            ) : (
              <>
                You are under the market here. This moves you closer to what
                other shops charge without going over them.
              </>
            )}
          </p>
          {floor > 0 && (
            <p className="text-[13px] text-muted-foreground">
              We will never suggest below{" "}
              <span className="font-mono">${floor.toFixed(2)}</span> for this
              product — that is your cost plus the margin you set.
            </p>
          )}
          {position && (
            <p className="border-t border-outline-variant/20 pt-3 text-[14px] text-muted-foreground">
              As things stand,{" "}
              {position.status === "LEADING"
                ? "you undercut them"
                : position.status === "OVERPRICED"
                  ? "you are the dearer option"
                  : position.status === "COMPETITIVE"
                    ? "you are priced much like them"
                    : "there is not enough to compare against"}
              {position.priceDiff != null && (
                <>
                  {" "}
                  by{" "}
                  <span className="font-mono">
                    ${Math.abs(position.priceDiff).toFixed(2)}
                  </span>
                </>
              )}
              .
            </p>
          )}
          <button
            type="button"
            className="w-full rounded bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
            onClick={() =>
              generateMutation.mutate({
                productId,
                storeId: selectedShopId ?? undefined,
              })
            }
            disabled={generateMutation.isPending || suggested == null}
          >
            {generateMutation.isPending
              ? "Adding..."
              : "Put this on my to-do list"}
          </button>
          <p className="text-center text-[12px] text-muted-foreground">
            This adds it to your Overview. Your shop is not changed.
          </p>
          {generateMutation.isSuccess && (
            <p className="text-center text-[13px] font-medium text-[var(--success)]">
              Added. You will find it on your Overview.
            </p>
          )}
          {generateMutation.isError && (
            <p className="text-center text-[13px] font-medium text-[var(--destructive)]">
              Could not add it. Try again in a moment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pricing Dashboard Summary (aggregate stats) ──────────────────────────────

export function PricingDashboardSummary() {
  const [, setLocation] = useLocation();
  const { selectedShopId } = useShopContext();
  const { data, isLoading } = trpc.pricingEngine.dashboardStats.useQuery(
    selectedShopId ? { storeId: selectedShopId } : undefined
  );

  const stats: DashboardStats = data ?? {
    leading: 0,
    competitive: 0,
    overpriced: 0,
    insufficientData: 0,
    marginProtection: 0,
    total: 0,
  };

  const cards = [
    {
      label: "Cheaper than them",
      hint: "Your price is under the average of the shops we found",
      stand: "LEADING",
      count: stats.leading,
      icon: TrendingDown,
      iconColor: "text-[var(--success)]",
      bgColor: "bg-[var(--success)]/10",
      borderColor: "border-[var(--success)]/20",
      textColor: "text-[var(--success)]",
    },
    {
      label: "About the same",
      hint: "Your price is within 3% of their average",
      stand: "COMPETITIVE",
      count: stats.competitive,
      icon: DollarSign,
      iconColor: "text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      textColor: "text-blue-400",
    },
    {
      label: "Dearer than them",
      hint: "Your price is above their average — the usual place to look first",
      stand: "OVERPRICED",
      count: stats.overpriced,
      icon: TrendingUp,
      iconColor: "text-[var(--destructive)]",
      bgColor: "bg-[var(--destructive)]/15",
      borderColor: "border-[var(--destructive)]/20",
      textColor: "text-[var(--destructive)]",
    },
    {
      label: "Nothing to compare",
      hint: "We have not found shops selling these yet",
      stand: "INSUFFICIENT_DATA",
      count: stats.insufficientData,
      icon: BarChart3,
      iconColor: "text-gray-400",
      bgColor: "bg-gray-500/10",
      borderColor: "border-gray-500/20",
      textColor: "text-gray-400",
    },
  ];

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="px-5 py-3 bg-surface-container/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[15px] font-semibold">
            Where your prices sit against the market
          </h3>
        </div>
        {stats.marginProtection > 0 && (
          <div className="flex items-center gap-1.5 bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 rounded px-2 py-0.5">
            <Shield className="h-3 w-3 text-[var(--destructive)]" />
            <span
              className="text-[13px] font-medium text-[var(--destructive)]"
              title="On these, your cost set the price rather than the market"
            >
              {stats.marginProtection} held up by your cost
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass-card p-4 rounded animate-pulse">
                <div className="h-3 bg-surface-container-highest rounded w-1/2 mb-2" />
                <div className="h-6 bg-surface-container-highest rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cards.map(card => (
              <button
                type="button"
                key={card.label}
                onClick={() =>
                  setLocation(
                    card.count > 0 ? `/products?stand=${card.stand}` : "/products"
                  )
                }
                className={cn(
                  "glass-card rounded border p-4 text-left transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
                  card.borderColor
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span
                    className="text-[13px] font-medium text-muted-foreground"
                    title={card.hint}
                  >
                    {card.label}
                  </span>
                  <div className={cn("p-1 rounded", card.bgColor)}>
                    <card.icon className={cn("h-3.5 w-3.5", card.iconColor)} />
                  </div>
                </div>
                <p
                  className={cn(
                    "text-2xl font-bold font-mono tracking-tight",
                    card.textColor
                  )}
                >
                  {card.count}
                </p>
                {stats.total > 0 && (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {((card.count / stats.total) * 100).toFixed(0)}% of your{" "}
                    {stats.total} products
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
