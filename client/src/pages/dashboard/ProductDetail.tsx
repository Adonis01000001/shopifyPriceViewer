import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Package,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import { PricingRecommendationWidget } from "@/components/dashboard/PricingRecommendationWidget";
import { toast } from "sonner";

function getWisdomFactors(value: unknown): {
  marketContext: string;
  riskFactors: string[];
} | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const factors = value as Record<string, unknown>;
  if (factors.source !== "path-of-wisdom") return null;
  return {
    marketContext:
      typeof factors.marketContext === "string" ? factors.marketContext : "",
    riskFactors: Array.isArray(factors.riskFactors)
      ? factors.riskFactors.filter(
          (risk): risk is string => typeof risk === "string"
        )
      : [],
  };
}

const statusConfig: Record<string, { label: string; className: string }> = {
  optimal: {
    label: "Optimal",
    className: "bg-primary/[0.1] text-primary border border-primary/20",
  },
  underpriced: {
    label: "Underpriced",
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  },
  overpriced: {
    label: "Overpriced",
    className:
      "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/30",
  },
  alert: {
    label: "Alert",
    className:
      "bg-[var(--destructive)]/20 text-[var(--destructive)] border border-[var(--destructive)]/30",
  },
};

export default function ProductDetail() {
  const [, params] = useRoute("/products/:id");
  const [, navigate] = useLocation();
  const productId = params?.id;

  const {
    data: product,
    isLoading,
    error,
  } = trpc.products.getById.useQuery(
    { id: productId ?? "" },
    { enabled: !!productId }
  );

  const { data: competitorPrices } = trpc.products.getCompetitorPrices.useQuery(
    { productId: productId ?? "" },
    { enabled: !!productId }
  );
  const { data: savedRecommendations } =
    trpc.recommendations.getByProduct.useQuery(
      { productId: productId ?? "" },
      { enabled: !!productId }
    );
  const utils = trpc.useUtils();
  const implementWisdomMutation = trpc.recommendations.implement.useMutation({
    onSuccess: () => {
      toast.success("Path of Wisdom recommendation applied");
      if (productId) {
        utils.products.getById.invalidate({ id: productId });
        utils.recommendations.getByProduct.invalidate({ productId });
      }
    },
    onError: error =>
      toast.error(error.message || "Failed to apply recommendation"),
  });

  const wisdomRecommendation = savedRecommendations?.find(recommendation =>
    getWisdomFactors(recommendation.factors)
  );
  const wisdomFactors = wisdomRecommendation
    ? getWisdomFactors(wisdomRecommendation.factors)
    : null;

  if (error) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate("/products")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Products
        </button>
        <div className="glass-panel rounded-lg p-12 text-center">
          <p className="text-[var(--destructive)] text-sm mb-3">
            {error.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/products")}
          >
            Return to Products
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton />;
  if (!product) return null;

  const status = statusConfig[product.status] ?? statusConfig.optimal;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate("/products")}
        type="button"
        className="text-link inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors"
        aria-label="Back to products"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Products
      </button>

      {/* Product Header */}
      <section className="product-hero" aria-labelledby="product-title">
        <div className="product-hero-layout">
          <div className="product-hero-media">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <Package className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1
                id="product-title"
                className="truncate text-2xl font-bold text-foreground sm:text-3xl"
              >
                {product.title}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold label-caps",
                  status.className
                )}
              >
                {status.label.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
              {product.sku && (
                <span className="font-mono text-[12px]">
                  SKU: {product.sku}
                </span>
              )}
              {product.category && <span>{product.category}</span>}
              {product.vendor && <span>{product.vendor}</span>}
            </div>
          </div>
          <div className="product-hero-price">
            <p className="font-mono text-3xl font-bold tracking-tight text-primary">
              ${Number(product.price).toFixed(2)}
            </p>
            {product.compareAtPrice &&
              Number(product.compareAtPrice) > Number(product.price) && (
                <p className="text-sm font-mono text-muted-foreground line-through">
                  ${Number(product.compareAtPrice).toFixed(2)}
                </p>
              )}
          </div>
        </div>
      </section>

      {/* Two-column layout: Market Insight + Competitor Prices */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Pricing Recommendation Widget */}
        <div className="space-y-6">
          {wisdomRecommendation && wisdomFactors && (
            <div className="glass-panel rounded-lg overflow-hidden border border-primary/20">
              <div className="px-5 py-3 bg-primary/10 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-[14px] font-semibold">
                  Path of Wisdom Recommendation
                </h3>
                <Badge
                  variant="outline"
                  className="ml-auto text-[10px] font-mono capitalize"
                >
                  {wisdomRecommendation.status}
                </Badge>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="glass-card rounded p-3">
                    <p className="label-caps text-muted-foreground/60 text-[10px]">
                      Current
                    </p>
                    <p className="mt-1 text-lg font-bold font-mono">
                      ${Number(wisdomRecommendation.currentPrice).toFixed(2)}
                    </p>
                  </div>
                  <div className="glass-card rounded p-3">
                    <p className="label-caps text-muted-foreground/60 text-[10px]">
                      Recommended
                    </p>
                    <p className="mt-1 text-lg font-bold font-mono text-primary">
                      $
                      {Number(wisdomRecommendation.recommendedPrice).toFixed(2)}
                    </p>
                  </div>
                  <div className="glass-card rounded p-3 col-span-2 sm:col-span-1">
                    <p className="label-caps text-muted-foreground/60 text-[10px]">
                      Change
                    </p>
                    <p className="mt-1 text-lg font-bold font-mono">
                      {Number(wisdomRecommendation.priceChange) > 0 ? "+" : ""}$
                      {Number(wisdomRecommendation.priceChange).toFixed(2)}
                    </p>
                  </div>
                </div>

                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  {wisdomRecommendation.reason}
                </p>

                {wisdomFactors.marketContext && (
                  <div className="rounded bg-surface-container-highest/50 p-3">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {wisdomFactors.marketContext}
                    </p>
                  </div>
                )}

                {wisdomFactors.riskFactors.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="label-caps text-[10px] font-bold text-muted-foreground/60">
                      Risks
                    </p>
                    {wisdomFactors.riskFactors.map((risk, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-muted-foreground">
                          {risk}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full"
                  onClick={() =>
                    implementWisdomMutation.mutate({
                      id: wisdomRecommendation.id,
                    })
                  }
                  disabled={
                    wisdomRecommendation.status !== "pending" ||
                    implementWisdomMutation.isPending
                  }
                >
                  {implementWisdomMutation.isPending
                    ? "Applying..."
                    : wisdomRecommendation.status === "implemented"
                      ? "Recommendation applied"
                      : wisdomRecommendation.status === "dismissed"
                        ? "Recommendation dismissed"
                        : "Apply recommendation"}
                </Button>
              </div>
            </div>
          )}
          <PricingRecommendationWidget productId={product.id} />
        </div>

        {/* Right: Competitor Prices */}
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-surface-container/50 flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Competitor Prices</h3>
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {competitorPrices?.length ?? 0} matched
            </Badge>
          </div>
          <div className="divide-y divide-outline-variant/20">
            {competitorPrices && competitorPrices.length > 0 ? (
              competitorPrices.map(cp => {
                const myPrice = Number(product.price);
                const cpPrice = Number(cp.price);
                const diff = cpPrice - myPrice;
                const diffPct = myPrice > 0 ? (diff / myPrice) * 100 : 0;
                return (
                  <div
                    key={cp.id}
                    className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-surface-container-low"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate">
                        {cp.title || cp.competitorDomain || "Unknown"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {cp.competitorName}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          match: {Number(cp.matchScore).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-[14px] font-bold font-mono">
                        ${cpPrice.toFixed(2)}
                      </p>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        {diff > 0 ? (
                          <>
                            <TrendingUp className="h-3 w-3 text-[var(--destructive)]" />
                            <span className="text-[10px] font-mono text-[var(--destructive)]">
                              +${diff.toFixed(2)}
                            </span>
                          </>
                        ) : diff < 0 ? (
                          <>
                            <TrendingDown className="h-3 w-3 text-[var(--success)]" />
                            <span className="text-[10px] font-mono text-[var(--success)]">
                              -${Math.abs(diff).toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <>
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[10px] font-mono text-muted-foreground">
                              $0.00
                            </span>
                          </>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground">
                          ({diffPct > 0 ? "+" : ""}
                          {diffPct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-5 py-12 text-center text-muted-foreground text-sm">
                No competitor prices tracked for this product yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Product Metadata */}
      {product.description && (
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-surface-container/50">
            <h3 className="text-[14px] font-semibold">Description</h3>
          </div>
          <div className="p-5 text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {product.description}
          </div>
        </div>
      )}
    </div>
  );
}
