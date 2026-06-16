import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  TrendingDown, TrendingUp, Shield, AlertTriangle,
  DollarSign, Target, BarChart3,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type MarketPositionStatus = "LEADING" | "COMPETITIVE" | "OVERPRICED" | "INSUFFICIENT_DATA";

interface PositionBadgeProps {
  status: MarketPositionStatus | undefined;
  label: string | undefined;
  priceDiffPercent: number | null | undefined;
}

interface DashboardStats {
  leading: number;
  competitive: number;
  overpriced: number;
  insufficientData: number;
  marginProtection: number;
  total: number;
}

// ─── Market Position Badge ───────────────────────────────────────────────────

const STATUS_STYLES: Record<MarketPositionStatus, { bg: string; text: string; border: string }> = {
  LEADING: {
    bg: "bg-[#21a732]/10",
    text: "text-[#21a732]",
    border: "border-[#21a732]/30",
  },
  COMPETITIVE: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  OVERPRICED: {
    bg: "bg-[#93000a]/15",
    text: "text-[#ffb4ab]",
    border: "border-[#93000a]/30",
  },
  INSUFFICIENT_DATA: {
    bg: "bg-gray-500/10",
    text: "text-gray-400",
    border: "border-gray-500/30",
  },
};

const STATUS_LABELS: Record<MarketPositionStatus, string> = {
  LEADING: "LEAD",
  COMPETITIVE: "COMP",
  OVERPRICED: "OVER",
  INSUFFICIENT_DATA: "N/A",
};

function PositionBadge({ status, label, priceDiffPercent }: PositionBadgeProps) {
  const style = status ? STATUS_STYLES[status] : STATUS_STYLES.INSUFFICIENT_DATA;
  const displayLabel = label ?? (status ? STATUS_LABELS[status] : "N/A");

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps",
          style.bg,
          style.text,
          "border",
          style.border,
        )}
      >
        {displayLabel}
      </span>
      {priceDiffPercent != null && (
        <span
          className={cn(
            "text-[10px] font-mono font-medium",
            priceDiffPercent > 0 ? "text-[#ffb4ab]" : priceDiffPercent < 0 ? "text-[#21a732]" : "text-muted-foreground",
          )}
        >
          {priceDiffPercent > 0 ? "+" : ""}
          {priceDiffPercent.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

// ─── Pricing Recommendation Widget (per-product) ─────────────────────────────

interface PricingRecommendationWidgetProps {
  productId: string;
}

export function PricingRecommendationWidget({ productId }: PricingRecommendationWidgetProps) {
  const { data, isLoading } = trpc.pricingEngine.analyze.useQuery(
    { productId },
    { enabled: !!productId },
  );
  const generateMutation = trpc.pricingEngine.generateRecommendation.useMutation();

  const snapshot = data?.marketSnapshot;
  const recommendation = data?.recommendation;
  const position = data?.position;

  const stats = useMemo(() => {
    if (!snapshot) return null;
    return {
      avgCompetitor: snapshot.avgCompetitorPrice != null ? `$${snapshot.avgCompetitorPrice.toFixed(2)}` : "—",
      lowestCompetitor: snapshot.lowestCompetitorPrice != null ? `$${snapshot.lowestCompetitorPrice.toFixed(2)}` : "—",
      highestCompetitor: snapshot.highestCompetitorPrice != null ? `$${snapshot.highestCompetitorPrice.toFixed(2)}` : "—",
      competitorCount: snapshot.competitorCount,
    };
  }, [snapshot]);

  if (isLoading) {
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

  if (!data) {
    return (
      <div className="glass-panel rounded-lg p-5 text-center text-muted-foreground text-sm">
        No pricing data available for this product.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Market Snapshot */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[14px] font-semibold">Market Snapshot</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <div className="glass-card p-3 rounded">
            <p className="label-caps text-muted-foreground/60 text-[10px]">Merchant Price</p>
            <p className="text-lg font-bold font-mono mt-1">${snapshot?.merchantPrice.toFixed(2)}</p>
          </div>
          <div className="glass-card p-3 rounded">
            <p className="label-caps text-muted-foreground/60 text-[10px]">Avg. Competitor</p>
            <p className="text-lg font-bold font-mono mt-1">{stats?.avgCompetitor}</p>
          </div>
          <div className="glass-card p-3 rounded">
            <p className="label-caps text-muted-foreground/60 text-[10px]">Lowest Competitor</p>
            <p className="text-sm font-mono mt-1 text-[#21a732]">{stats?.lowestCompetitor}</p>
          </div>
          <div className="glass-card p-3 rounded">
            <p className="label-caps text-muted-foreground/60 text-[10px]">Highest Competitor</p>
            <p className="text-sm font-mono mt-1 text-[#ffb4ab]">{stats?.highestCompetitor}</p>
          </div>
        </div>
        <div className="px-4 pb-3">
          <p className="text-[11px] text-muted-foreground">
            Based on <span className="font-mono font-medium text-muted-foreground">{stats?.competitorCount}</span> competitor price{stats?.competitorCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Recommendation Card */}
      {recommendation ? (
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Recommendation</h3>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="label-caps text-muted-foreground/60 text-[10px]">Recommended Price</p>
                <p className="text-2xl font-bold font-mono text-primary">${recommendation.recommendedPrice.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="label-caps text-muted-foreground/60 text-[10px]">Floor Price</p>
                <p className="text-sm font-mono text-muted-foreground">
                  ${recommendation.minimumAllowedPrice > 0 ? recommendation.minimumAllowedPrice.toFixed(2) : "—"}
                </p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{recommendation.explanation}</p>
            <button
              className="w-full px-4 py-2 bg-primary text-primary-foreground text-[11px] font-bold label-caps rounded hover:brightness-110 transition-all disabled:opacity-50"
              onClick={() => generateMutation.mutate({ productId })}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? "Generating..." : "Save Recommendation"}
            </button>
            {generateMutation.isSuccess && (
              <p className="text-[11px] text-[#21a732] font-medium text-center">Recommendation saved successfully.</p>
            )}
            {generateMutation.isError && (
              <p className="text-[11px] text-[#ffb4ab] font-medium text-center">Failed to save recommendation.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="glass-panel rounded-lg p-4 text-center text-muted-foreground text-sm">
          <p>No recommendation available. Need at least one competitor price.</p>
        </div>
      )}

      {/* Position Indicator */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h3 className="text-[14px] font-semibold">Market Position</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <PositionBadge
              status={position?.status}
              label={position?.label}
              priceDiffPercent={position?.priceDiffPercent}
            />
          </div>
          {position && (
            <p className="text-[12px] text-muted-foreground">{position.meaning}</p>
          )}
          {position?.priceDiff != null && (
            <div className="flex items-center gap-2">
              {position.priceDiff > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-[#ffb4ab]" />
              ) : position.priceDiff < 0 ? (
                <TrendingDown className="h-3.5 w-3.5 text-[#21a732]" />
              ) : (
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-[11px] font-mono text-muted-foreground">
                {position.priceDiff > 0 ? "+" : ""}${position.priceDiff.toFixed(2)} vs avg competitor
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Margin Protection Warning */}
      {recommendation?.marginProtectionApplied && (
        <div className="glass-panel rounded-lg overflow-hidden border border-[#93000a]/30">
          <div className="px-5 py-3 border-b border-white/[0.04] bg-[#93000a]/10 flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#ffb4ab]" />
            <h3 className="text-[14px] font-semibold text-[#ffb4ab]">Margin Protection Active</h3>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-[#ffb4ab] mt-0.5 shrink-0" />
              <p className="text-[12px] text-[#ffb4ab]/80 leading-relaxed">
                The 5% undercut price is below your minimum profit margin floor. The recommended price has been
                adjusted to maintain at least 10% margin above cost price.
              </p>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground">
              Floor: <span className="text-[#ffb4ab]">${recommendation.minimumAllowedPrice.toFixed(2)}</span> (cost + 10%)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pricing Dashboard Summary (aggregate stats) ──────────────────────────────

export function PricingDashboardSummary() {
  const { data, isLoading } = trpc.pricingEngine.dashboardStats.useQuery();

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
      label: "Leading",
      count: stats.leading,
      icon: TrendingDown,
      iconColor: "text-[#21a732]",
      bgColor: "bg-[#21a732]/10",
      borderColor: "border-[#21a732]/20",
      textColor: "text-[#21a732]",
    },
    {
      label: "Competitive",
      count: stats.competitive,
      icon: DollarSign,
      iconColor: "text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      textColor: "text-blue-400",
    },
    {
      label: "Overpriced",
      count: stats.overpriced,
      icon: TrendingUp,
      iconColor: "text-[#ffb4ab]",
      bgColor: "bg-[#93000a]/15",
      borderColor: "border-[#93000a]/20",
      textColor: "text-[#ffb4ab]",
    },
    {
      label: "No Data",
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
      <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-[14px] font-semibold">Pricing Position Summary</h3>
        </div>
        {stats.marginProtection > 0 && (
          <div className="flex items-center gap-1.5 bg-[#93000a]/10 border border-[#93000a]/20 rounded px-2 py-0.5">
            <Shield className="h-3 w-3 text-[#ffb4ab]" />
            <span className="text-[10px] font-mono font-bold text-[#ffb4ab] label-caps">
              {stats.marginProtection} Margin Protected
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-card p-4 rounded animate-pulse">
                <div className="h-3 bg-surface-container-highest rounded w-1/2 mb-2" />
                <div className="h-6 bg-surface-container-highest rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cards.map((card) => (
              <div
                key={card.label}
                className={cn(
                  "glass-card p-4 rounded border transition-all hover:brightness-110",
                  card.borderColor,
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="label-caps text-muted-foreground/60 text-[10px]">{card.label}</span>
                  <div className={cn("p-1 rounded", card.bgColor)}>
                    <card.icon className={cn("h-3.5 w-3.5", card.iconColor)} />
                  </div>
                </div>
                <p className={cn("text-2xl font-bold font-mono tracking-tight", card.textColor)}>
                  {card.count}
                </p>
                {stats.total > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {((card.count / stats.total) * 100).toFixed(0)}% of tracked
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
