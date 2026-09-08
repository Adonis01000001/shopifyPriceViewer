import { useState, type FormEvent } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import { PricingRecommendationWidget } from "@/components/dashboard/PricingRecommendationWidget";
import { ProductEvidence } from "@/components/dashboard/ProductEvidence";
import { getStoreDashboardPath, useShopContext } from "@/contexts/ShopContext";
import { toast } from "sonner";


const statusConfig: Record<string, { label: string; className: string }> = {
  optimal: {
    label: "Priced well",
    className: "bg-primary/[0.1] text-primary border border-primary/20",
  },
  underpriced: {
    label: "Under the market",
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  },
  overpriced: {
    label: "Over the market",
    className:
      "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/30",
  },
  alert: {
    label: "Needs a look",
    className:
      "bg-[var(--destructive)]/20 text-[var(--destructive)] border border-[var(--destructive)]/30",
  },
};

export default function ProductDetail() {
  const [, scopedParams] = useRoute("/dashboard/:connectionId/products/:id");
  const [, legacyParams] = useRoute("/products/:id");
  const [, navigate] = useLocation();
  const { selectedShopId } = useShopContext();
  const productId = scopedParams?.id ?? legacyParams?.id;
  const productsPath = getStoreDashboardPath(selectedShopId ?? "", "/products");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualFormError, setManualFormError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const addManualProduct = trpc.competitors.addManualProduct.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.products.getById.invalidate({
          id: productId ?? "",
          storeId: selectedShopId ?? undefined,
        }),
        utils.products.getCompetitorPrices.invalidate({
          productId: productId ?? "",
          storeId: selectedShopId ?? undefined,
        }),
        utils.pipeline.productEvidence.invalidate({
          productId: productId ?? "",
          storeId: selectedShopId ?? undefined,
        }),
      ]);
      setManualDialogOpen(false);
      setManualUrl("");
      setManualPrice("");
      setManualFormError(null);
      toast.success("Competitor price added");
    },
    onError: error => {
      const message = error.message || "Could not add competitor price";
      setManualFormError(message);
      toast.error(message);
    },
  });

  const {
    data: product,
    isLoading,
    error,
  } = trpc.products.getById.useQuery(
    { id: productId ?? "", storeId: selectedShopId ?? undefined },
    { enabled: !!productId }
  );

  const {
    data: competitorPrices,
    isLoading: competitorPricesLoading,
    isError: competitorPricesError,
    refetch: refetchCompetitorPrices,
  } = trpc.products.getCompetitorPrices.useQuery(
    { productId: productId ?? "", storeId: selectedShopId ?? undefined },
    { enabled: !!productId }
  );

  const submitManualProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualFormError(null);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(manualUrl.trim());
    } catch {
      setManualFormError("Enter a valid shop or product URL.");
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      setManualFormError("The URL must use http or https.");
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(manualPrice.trim()) || Number(manualPrice) <= 0) {
      setManualFormError("Enter a price greater than zero, with up to two decimals.");
      return;
    }
    if (!productId) return;

    addManualProduct.mutate({
      productId,
      competitorUrl: parsedUrl.toString(),
      price: manualPrice.trim(),
      storeId: selectedShopId ?? undefined,
    });
  };

  if (error) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate(selectedShopId ? productsPath : "/products")}
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
            onClick={() => navigate(selectedShopId ? productsPath : "/products")}
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
        onClick={() => navigate(selectedShopId ? productsPath : "/products")}
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
                  "inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-[13px] font-semibold",
                  status.className
                )}
              >
                {status.label}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
              {product.sku && (
                <span className="font-mono text-[13px]">
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
          <PricingRecommendationWidget productId={product.id} />
        </div>

        {/* Right: Competitor Prices */}
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-surface-container/50 flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-primary" />
            <h3 className="text-[15px] font-semibold">
              Shops selling the same thing
            </h3>
            <Badge variant="outline" className="ml-auto text-[12px] font-mono">
              {competitorPrices?.length ?? 0} found
            </Badge>
          </div>
          <div className="divide-y divide-outline-variant/20">
            {competitorPricesLoading ? (
              <div className="px-5 py-12 text-center text-[14px] text-muted-foreground">
                Loading shops…
              </div>
            ) : competitorPricesError ? (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center text-[14px] text-muted-foreground">
                <p>We could not load the shops checked for this product.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refetchCompetitorPrices()}
                >
                  Try again
                </Button>
              </div>
            ) : competitorPrices && competitorPrices.length > 0 ? (
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
                      <p className="text-[14px] font-medium truncate">
                        {cp.title || cp.competitorDomain || "Unknown"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[13px] text-muted-foreground">
                          {cp.competitorName}
                        </span>
                        {cp.matchMethod === "manual" ? (
                          <span className="text-[12px] text-amber-300">
                            Price supplied manually · not independently verified
                          </span>
                        ) : (
                          <span
                            className="text-[12px] font-mono text-muted-foreground"
                            title="How sure we are this is the same product"
                          >
                            {Math.round(Number(cp.matchScore) * 100)}% sure it is
                            the same product
                          </span>
                        )}
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
                            <span className="text-[12px] font-mono text-[var(--destructive)]">
                              +${diff.toFixed(2)}
                            </span>
                          </>
                        ) : diff < 0 ? (
                          <>
                            <TrendingDown className="h-3 w-3 text-[var(--success)]" />
                            <span className="text-[12px] font-mono text-[var(--success)]">
                              -${Math.abs(diff).toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <>
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[12px] font-mono text-muted-foreground">
                              $0.00
                            </span>
                          </>
                        )}
                        <span className="text-[12px] font-mono text-muted-foreground">
                          ({diffPct > 0 ? "+" : ""}
                          {diffPct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : competitorPrices ? (
              <div className="flex flex-col items-center gap-4 px-5 py-12 text-center text-[14px] text-muted-foreground">
                <p>
                  No shop was found selling this exact product. The list below
                  shows every shop we looked at and why each was ruled out.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setManualFormError(null);
                    setManualDialogOpen(true);
                  }}
                >
                  I know a shop that sells this
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={manualDialogOpen}
        onOpenChange={open => {
          if (!addManualProduct.isPending) setManualDialogOpen(open);
          if (!open) setManualFormError(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add a shop price</DialogTitle>
            <DialogDescription>
              Paste the product page you are looking at and enter the price
              shown there. This price will be marked as manually supplied.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitManualProduct} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-competitor-url">Shop/product page URL</Label>
              <Input
                id="manual-competitor-url"
                type="url"
                value={manualUrl}
                onChange={event => setManualUrl(event.target.value)}
                placeholder="https://shop.example.com/product"
                disabled={addManualProduct.isPending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-competitor-price">Price</Label>
              <Input
                id="manual-competitor-price"
                type="number"
                min="0.01"
                step="0.01"
                value={manualPrice}
                onChange={event => setManualPrice(event.target.value)}
                placeholder="0.00"
                disabled={addManualProduct.isPending}
                required
              />
            </div>
            {manualFormError && (
              <p className="text-sm text-[var(--destructive)]" role="alert">
                {manualFormError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualDialogOpen(false)}
                disabled={addManualProduct.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addManualProduct.isPending}>
                {addManualProduct.isPending ? "Adding…" : "Add price"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* The working behind the suggestion */}
      <ProductEvidence productId={product.id} storeId={selectedShopId ?? undefined} />

      {/* Product Metadata */}
      {product.description && (
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-3 bg-surface-container/50">
            <h3 className="text-[14px] font-semibold">Description</h3>
          </div>
          <div className="p-5 text-[14px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {product.description}
          </div>
        </div>
      )}
    </div>
  );
}
