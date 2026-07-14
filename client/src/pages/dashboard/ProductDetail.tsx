import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowLeft, Package, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import { PricingRecommendationWidget } from "@/components/dashboard/PricingRecommendationWidget";

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
    className: "bg-[#93000a]/15 text-[#ffb4ab] border border-[#93000a]/30",
  },
  alert: {
    label: "Alert",
    className: "bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30",
  },
};

export default function ProductDetail() {
  const [, params] = useRoute("/products/:id");
  const [, navigate] = useLocation();
  const productId = params?.id;

  const { data: product, isLoading, error } = trpc.products.getById.useQuery(
    { id: productId ?? "" },
    { enabled: !!productId }
  );

  const { data: competitorPrices } = trpc.products.getCompetitorPrices.useQuery(
    { productId: productId ?? "" },
    { enabled: !!productId }
  );

  if (error) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate("/products")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Products
        </button>
        <div className="glass-panel rounded-lg p-12 text-center">
          <p className="text-[#ffb4ab] text-sm mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/products")}>
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
    <div className="space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate("/products")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Products
      </button>

      {/* Product Header */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="p-6 flex items-start gap-5">
          <div className="w-14 h-14 rounded-xl bg-surface-container-highest border border-outline-variant flex items-center justify-center shrink-0">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="w-full h-full object-cover rounded-xl" />
            ) : (
              <Package className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-extrabold text-primary truncate">{product.title}</h1>
              <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold label-caps", status.className)}>
                {status.label.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
              {product.sku && (
                <span className="font-mono text-[12px]">SKU: {product.sku}</span>
              )}
              {product.category && <span>{product.category}</span>}
              {product.vendor && <span>{product.vendor}</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold font-mono tracking-tight text-primary">
              ${Number(product.price).toFixed(2)}
            </p>
            {product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price) && (
              <p className="text-sm font-mono text-muted-foreground line-through">
                ${Number(product.compareAtPrice).toFixed(2)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout: Market Insight + Competitor Prices */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Pricing Recommendation Widget */}
        <PricingRecommendationWidget productId={product.id} />

        {/* Right: Competitor Prices */}
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Competitor Prices</h3>
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {competitorPrices?.length ?? 0} matched
            </Badge>
          </div>
          <div className="divide-y divide-outline-variant/20">
            {competitorPrices && competitorPrices.length > 0 ? (
              competitorPrices.map((cp) => {
                const myPrice = Number(product.price);
                const cpPrice = Number(cp.price);
                const diff = cpPrice - myPrice;
                const diffPct = myPrice > 0 ? (diff / myPrice) * 100 : 0;
                return (
                  <div key={cp.id} className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate">
                        {cp.title || cp.competitorDomain || "Unknown"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground">{cp.competitorName}</span>
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
                            <TrendingUp className="h-3 w-3 text-[#ffb4ab]" />
                            <span className="text-[10px] font-mono text-[#ffb4ab]">+${diff.toFixed(2)}</span>
                          </>
                        ) : diff < 0 ? (
                          <>
                            <TrendingDown className="h-3 w-3 text-[#21a732]" />
                            <span className="text-[10px] font-mono text-[#21a732]">-${Math.abs(diff).toFixed(2)}</span>
                          </>
                        ) : (
                          <>
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[10px] font-mono text-muted-foreground">$0.00</span>
                          </>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground">
                          ({diffPct > 0 ? "+" : ""}{diffPct.toFixed(1)}%)
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
          <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50">
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