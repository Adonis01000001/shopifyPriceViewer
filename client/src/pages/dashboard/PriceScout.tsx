import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Globe,
  Search,
  TrendingDown,
  TrendingUp,
  Loader2,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Zap,
  MessageSquare,
  Database,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScoutPrice {
  sourceUrl: string;
  domain: string;
  title: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  position: number;
  confidence: number;
}

interface ScoutResult {
  productId: string;
  productTitle: string;
  productPrice: string;
  prices: ScoutPrice[];
  totalFound: number;
  searchEngine: string;
  status: "success" | "partial" | "failed";
  errorMessage: string | null;
  reviews?: Array<{ title: string; snippet: string; url: string }>;
  searchQueries?: string[];
}

// ─── Product Scout Card ──────────────────────────────────────────────────────

function ProductScoutCard({
  result,
  onScout,
  isScouting,
  onScoutSerpApi,
  isScoutingSerpApi,
  onScoutExa,
  isScoutingExa,
}: {
  result: ScoutResult;
  onScout: () => void;
  isScouting: boolean;
  onScoutSerpApi: () => void;
  isScoutingSerpApi: boolean;
  onScoutExa: () => void;
  isScoutingExa: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [showQueries, setShowQueries] = useState(false);
  const {
    productTitle,
    productPrice,
    prices,
    status,
    errorMessage,
    totalFound,
    reviews,
    searchQueries,
  } = result;

  const numericPrices = prices
    .map(p => parseFloat(p.price))
    .filter(p => !isNaN(p) && p > 0);
  const minPrice = numericPrices.length > 0 ? Math.min(...numericPrices) : null;
  const maxPrice = numericPrices.length > 0 ? Math.max(...numericPrices) : null;
  const avgPrice =
    numericPrices.length > 0
      ? numericPrices.reduce((a, b) => a + b, 0) / numericPrices.length
      : null;
  const myPrice = parseFloat(productPrice);
  const vsMin =
    minPrice !== null && !isNaN(myPrice) ? myPrice - minPrice : null;

  const statusConfig: Record<
    string,
    { label: string; className: string; icon: typeof CheckCircle2 }
  > = {
    success: {
      label: "Complete",
      className: "bg-[#21a732]/10 text-[#21a732] border-[#21a732]/20",
      icon: CheckCircle2,
    },
    partial: {
      label: "Partial",
      className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      icon: AlertCircle,
    },
    failed: {
      label: "Failed",
      className: "bg-[#93000a]/15 text-[#ffb4ab] border-[#93000a]/20",
      icon: AlertCircle,
    },
  };
  const sc = statusConfig[status] ?? statusConfig.failed;
  const StatusIcon = sc.icon;

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[15px] font-semibold truncate">
                {productTitle}
              </h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold label-caps border shrink-0",
                  sc.className
                )}
              >
                <StatusIcon className="h-2.5 w-2.5" />
                {sc.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
              <span>
                Your price:{" "}
                <span className="font-mono font-medium text-foreground">
                  ${Number(productPrice).toFixed(2)}
                </span>
              </span>
              {minPrice !== null && (
                <span>
                  Market low:{" "}
                  <span className="font-mono font-medium text-[#21a732]">
                    ${minPrice.toFixed(2)}
                  </span>
                </span>
              )}
              {vsMin !== null && (
                <span
                  className={cn(
                    "font-mono font-medium",
                    vsMin > 0 ? "text-[#ffb4ab]" : "text-[#21a732]"
                  )}
                >
                  {vsMin > 0
                    ? `+$${vsMin.toFixed(2)} above`
                    : vsMin < 0
                      ? `$${Math.abs(vsMin).toFixed(2)} below`
                      : "At market low"}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-outline-variant text-[11px]"
              onClick={onScout}
              disabled={isScouting}
            >
              {isScouting ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Scouting...
                </>
              ) : (
                <>
                  <Search className="mr-1.5 h-3 w-3" />
                  Scout Web
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-outline-variant text-[11px]"
              onClick={onScoutSerpApi}
              disabled={isScoutingSerpApi}
              title="5 SerpAPI searches: name, price, review, buy, best deal"
            >
              {isScoutingSerpApi ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  SerpAPI...
                </>
              ) : (
                <>
                  <Database className="mr-1.5 h-3 w-3" />
                  SerpAPI
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-outline-variant text-[11px]"
              onClick={onScoutExa}
              disabled={isScoutingExa}
              title="Exa neural search: AI-powered structured product extraction"
            >
              {isScoutingExa ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Exa...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3 w-3" />
                  Exa
                </>
              )}
            </Button>
            {prices.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Price summary bar */}
        {prices.length > 0 && (
          <div className="flex items-center gap-3 mt-3 overflow-x-auto pb-1">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-container-highest rounded-full border border-outline-variant shrink-0">
              <Globe className="h-3 w-3 text-primary" />
              <span className="label-caps text-[9px] text-muted-foreground">
                {totalFound} prices found
              </span>
            </div>
            {minPrice !== null && (
              <div className="flex items-center gap-1 px-2 py-1 bg-[#21a732]/10 rounded-full border border-[#21a732]/20 shrink-0">
                <TrendingDown className="h-3 w-3 text-[#21a732]" />
                <span className="font-mono text-[10px] font-bold text-[#21a732]">
                  ${minPrice.toFixed(2)}
                </span>
              </div>
            )}
            {maxPrice !== null && maxPrice !== minPrice && (
              <div className="flex items-center gap-1 px-2 py-1 bg-[#93000a]/10 rounded-full border border-[#93000a]/20 shrink-0">
                <TrendingUp className="h-3 w-3 text-[#ffb4ab]" />
                <span className="font-mono text-[10px] font-bold text-[#ffb4ab]">
                  ${maxPrice.toFixed(2)}
                </span>
              </div>
            )}
            {avgPrice !== null && (
              <div className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 rounded-full border border-blue-500/20 shrink-0">
                <span className="label-caps text-[9px] text-blue-400">AVG</span>
                <span className="font-mono text-[10px] font-bold text-blue-400">
                  ${avgPrice.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {status === "failed" && errorMessage && (
          <div className="mt-3 rounded border border-[#93000a]/20 bg-[#93000a]/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[#ffb4ab] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#ffb4ab]">{errorMessage}</p>
          </div>
        )}
      </div>

      {/* Expanded: Price list */}
      {expanded && prices.length > 0 && (
        <div className="divide-y divide-outline-variant/20">
          {prices.map((price, i) => {
            const p = parseFloat(price.price);
            const diff = !isNaN(p) && !isNaN(myPrice) ? p - myPrice : null;
            return (
              <div
                key={i}
                className="px-5 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-[11px] font-mono text-muted-foreground w-6 text-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] font-medium truncate">
                      {price.title}
                    </p>
                    <span className="text-[9px] label-caps text-muted-foreground bg-surface-container-highest px-1.5 py-0.5 rounded shrink-0">
                      {price.domain}
                    </span>
                  </div>
                  <a
                    href={price.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5"
                  >
                    {price.sourceUrl.slice(0, 60)}...{" "}
                    <ExternalLink className="h-2 w-2" />
                  </a>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-[13px] font-bold">
                    ${Number(price.price).toFixed(2)}
                  </span>
                  {diff !== null && (
                    <p
                      className={cn(
                        "font-mono text-[10px]",
                        diff < 0
                          ? "text-[#21a732]"
                          : diff > 0
                            ? "text-[#ffb4ab]"
                            : "text-muted-foreground"
                      )}
                    >
                      {diff < 0
                        ? `$${Math.abs(diff).toFixed(2)} cheaper`
                        : diff > 0
                          ? `+$${diff.toFixed(2)}`
                          : "same price"}
                    </p>
                  )}
                </div>
                <div className="w-16 shrink-0">
                  <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{
                        width: `${Math.round(price.confidence * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-[8px] text-muted-foreground text-center mt-0.5">
                    {Math.round(price.confidence * 100)}% conf
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Search Queries & Reviews (SerpAPI) */}
      {searchQueries && searchQueries.length > 0 && (
        <div className="border-t border-outline-variant/20">
          <button
            onClick={() => setShowQueries(!showQueries)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium">
                {searchQueries.length} search queries used
              </span>
            </div>
            {showQueries ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {showQueries && (
            <div className="px-5 pb-3 space-y-1">
              {searchQueries.map((q, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground font-mono w-4 shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-foreground bg-surface-container-highest px-2 py-0.5 rounded">
                    {q}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {reviews && reviews.length > 0 && (
        <div className="border-t border-outline-variant/20">
          <button
            onClick={() => setShowReviews(!showReviews)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium">
                {reviews.length} review snippets found
              </span>
            </div>
            {showReviews ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {showReviews && (
            <div className="px-5 pb-3 space-y-2">
              {reviews.map((r, i) => (
                <div key={i} className="bg-surface-container/50 rounded p-2.5">
                  <p className="text-[11px] font-medium text-foreground truncate">
                    {r.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {r.snippet}
                  </p>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-primary hover:underline flex items-center gap-0.5 mt-1"
                  >
                    {r.url.slice(0, 50)}... <ExternalLink className="h-2 w-2" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {prices.length === 0 &&
        status !== "failed" &&
        !isScouting &&
        !isScoutingSerpApi &&
        !isScoutingExa && (
          <div className="px-5 py-8 text-center text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-[12px]">
              Click "Scout Web", "SerpAPI", or "Exa" to search for this
              product's price
            </p>
          </div>
        )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PriceScout() {
  const [results, setResults] = useState<Record<string, ScoutResult>>({});
  const [scoutingIds, setScoutingIds] = useState<Set<string>>(new Set());
  const [scoutAllRunning, setScoutAllRunning] = useState(false);
  const [serpScoutingIds, setSerpScoutingIds] = useState<Set<string>>(
    new Set()
  );
  const [serpAllRunning, setSerpAllRunning] = useState(false);
  const [exaScoutingIds, setExaScoutingIds] = useState<Set<string>>(new Set());
  const [exaAllRunning, setExaAllRunning] = useState(false);

  const { data: products, isLoading: productsLoading } =
    trpc.products.list.useQuery(undefined, { staleTime: 1000 * 60 * 5 });
  const { data: scoutHistory, isLoading: scoutHistoryLoading } =
    trpc.scout.getAllScoutHistory.useQuery(undefined, { staleTime: 1000 * 60 * 5 });
  const scoutMutation = trpc.scout.scoutProduct.useMutation();
  const scoutAllMutation = trpc.scout.scoutAllProducts.useMutation();
  const scoutSerpApiMutation = trpc.scout.scoutProductSerpApi.useMutation();
  const scoutAllSerpApiMutation = trpc.scout.scoutAllSerpApi.useMutation();
  const scoutExaMutation = trpc.scout.scoutProductExa.useMutation();
  const scoutAllExaMutation = trpc.scout.scoutAllExa.useMutation();

  const handleScoutProduct = useCallback(
    async (productId: string) => {
      setScoutingIds(prev => new Set(prev).add(productId));
      try {
        const result = await scoutMutation.mutateAsync({
          productId,
          maxResults: 10,
        });
        setResults(prev => ({ ...prev, [productId]: result }));
        if (result.status === "success") {
          toast.success(
            `Found ${result.prices.length} prices for "${result.productTitle.slice(0, 40)}..."`
          );
        } else if (result.status === "partial") {
          toast.warning(
            `Found ${result.prices.length} prices (partial) for "${result.productTitle.slice(0, 40)}..."`
          );
        } else {
          toast.error(
            `Could not find prices for "${result.productTitle.slice(0, 40)}..."`
          );
        }
      } catch (err: any) {
        toast.error(err.message || "Scouting failed");
      } finally {
        setScoutingIds(prev => {
          const n = new Set(prev);
          n.delete(productId);
          return n;
        });
      }
    },
    [scoutMutation]
  );

  const handleScoutAll = useCallback(async () => {
    setScoutAllRunning(true);
    try {
      const allResults = await scoutAllMutation.mutateAsync({ maxResults: 10 });
      const newResults: Record<string, ScoutResult> = {};
      let totalFound = 0;
      for (const r of allResults) {
        newResults[r.productId] = r;
        totalFound += r.prices.length;
      }
      setResults(newResults);
      const successCount = allResults.filter(
        r => r.status === "success"
      ).length;
      toast.success(
        `Scouted ${allResults.length} products, found ${totalFound} total prices across ${successCount} products`
      );
    } catch (err: any) {
      toast.error(err.message || "Bulk scouting failed");
    } finally {
      setScoutAllRunning(false);
    }
  }, [scoutAllMutation]);

  const handleScoutSerpApi = useCallback(
    async (productId: string) => {
      setSerpScoutingIds(prev => new Set(prev).add(productId));
      try {
        const result = await scoutSerpApiMutation.mutateAsync({
          productId,
          maxResults: 10,
        });
        setResults(prev => ({ ...prev, [productId]: result }));
        if (result.status === "success") {
          toast.success(
            `SerpAPI: Found ${result.prices.length} prices, ${result.reviews?.length ?? 0} reviews for "${result.productTitle.slice(0, 40)}..."`
          );
        } else if (result.status === "partial") {
          toast.warning(
            `SerpAPI: Found ${result.prices.length} prices (partial) for "${result.productTitle.slice(0, 40)}..."`
          );
        } else {
          toast.error(`SerpAPI: ${result.errorMessage ?? "Failed"}`);
        }
      } catch (err: any) {
        toast.error(err.message || "SerpAPI scouting failed");
      } finally {
        setSerpScoutingIds(prev => {
          const n = new Set(prev);
          n.delete(productId);
          return n;
        });
      }
    },
    [scoutSerpApiMutation]
  );

  const handleScoutAllSerpApi = useCallback(async () => {
    setSerpAllRunning(true);
    try {
      const allResults = await scoutAllSerpApiMutation.mutateAsync({
        maxResults: 10,
      });
      const newResults: Record<string, ScoutResult> = {};
      let totalPrices = 0;
      let totalReviews = 0;
      for (const r of allResults) {
        newResults[r.productId] = r;
        totalPrices += r.prices.length;
        totalReviews += r.reviews?.length ?? 0;
      }
      setResults(newResults);
      const successCount = allResults.filter(
        r => r.status === "success"
      ).length;
      toast.success(
        `SerpAPI: Scouted ${allResults.length} products, ${totalPrices} prices, ${totalReviews} reviews across ${successCount} products`
      );
    } catch (err: any) {
      toast.error(err.message || "Bulk SerpAPI scouting failed");
    } finally {
      setSerpAllRunning(false);
    }
  }, [scoutAllSerpApiMutation]);

  const handleScoutExa = useCallback(
    async (productId: string) => {
      setExaScoutingIds(prev => new Set(prev).add(productId));
      try {
        const result = await scoutExaMutation.mutateAsync({
          productId,
          maxResults: 10,
        });
        setResults(prev => ({ ...prev, [productId]: result }));
        if (result.status === "success") {
          toast.success(
            `Exa: Found ${result.prices.length} prices for "${result.productTitle.slice(0, 40)}..."`
          );
        } else if (result.status === "partial") {
          toast.warning(
            `Exa: Found ${result.prices.length} prices (partial) for "${result.productTitle.slice(0, 40)}..."`
          );
        } else {
          toast.error(`Exa: ${result.errorMessage ?? "Failed"}`);
        }
      } catch (err: any) {
        toast.error(err.message || "Exa scouting failed");
      } finally {
        setExaScoutingIds(prev => {
          const n = new Set(prev);
          n.delete(productId);
          return n;
        });
      }
    },
    [scoutExaMutation]
  );

  const handleScoutAllExa = useCallback(async () => {
    setExaAllRunning(true);
    try {
      const allResults = await scoutAllExaMutation.mutateAsync({
        maxResults: 10,
      });
      const newResults: Record<string, ScoutResult> = {};
      let totalPrices = 0;
      for (const r of allResults) {
        newResults[r.productId] = r;
        totalPrices += r.prices.length;
      }
      setResults(newResults);
      const successCount = allResults.filter(
        r => r.status === "success"
      ).length;
      toast.success(
        `Exa: Scouted ${allResults.length} products, found ${totalPrices} prices across ${successCount} products`
      );
    } catch (err: any) {
      toast.error(err.message || "Bulk Exa scouting failed");
    } finally {
      setExaAllRunning(false);
    }
  }, [scoutAllExaMutation]);

  useEffect(() => {
    if (!scoutHistory || scoutHistory.length === 0) return;

    setResults(prev => {
      const next = { ...prev };
      for (const result of scoutHistory) {
        if (!next[result.productId]) {
          next[result.productId] = result;
        }
      }
      return next;
    });
  }, [scoutHistory]);

  const productList = products ?? [];
  const resultCount = Object.keys(results).length;
  const totalPrices = Object.values(results).reduce(
    (sum, r) => sum + r.prices.length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
              <Globe className="h-6 w-6" />
              Price Scout
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Search the web to find competitor prices for each of your
              products.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:brightness-110"
              onClick={handleScoutAll}
              disabled={
                scoutAllRunning || productsLoading || productList.length === 0
              }
            >
              {scoutAllRunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Scouting All...
                </>
              ) : (
                <>
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                  Scout All Products
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-outline-variant"
              onClick={handleScoutAllSerpApi}
              disabled={
                serpAllRunning || productsLoading || productList.length === 0
              }
              title="Run 5 SerpAPI searches per product (name, price, review, buy, best deal)"
            >
              {serpAllRunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  SerpAPI All...
                </>
              ) : (
                <>
                  <Database className="mr-1.5 h-3.5 w-3.5" />
                  SerpAPI All
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-outline-variant"
              onClick={handleScoutAllExa}
              disabled={
                exaAllRunning || productsLoading || productList.length === 0
              }
              title="Exa neural search with structured product extraction for all products"
            >
              {exaAllRunning ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Exa All...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Exa All
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      {resultCount > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="glass-card p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold font-mono tracking-tight">
                {resultCount}
              </p>
              <p className="label-caps text-muted-foreground/60">
                Products Scouted
              </p>
            </div>
            <Globe className="h-8 w-8 text-primary/30" />
          </div>
          <div className="glass-card p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold font-mono tracking-tight">
                {totalPrices}
              </p>
              <p className="label-caps text-muted-foreground/60">
                Prices Found
              </p>
            </div>
            <Search className="h-8 w-8 text-primary/30" />
          </div>
          <div className="glass-card p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold font-mono tracking-tight">
                {totalPrices > 0
                  ? `$${(
                      Object.values(results).reduce((sum, r) => {
                        const prices = r.prices
                          .map(p => parseFloat(p.price))
                          .filter(p => !isNaN(p));
                        return (
                          sum +
                          (prices.length > 0
                            ? prices.reduce((a, b) => a + b, 0) / prices.length
                            : 0)
                        );
                      }, 0) / resultCount
                    ).toFixed(2)}`
                  : "—"}
              </p>
              <p className="label-caps text-muted-foreground/60">
                Avg Market Price
              </p>
            </div>
            <TrendingDown className="h-8 w-8 text-primary/30" />
          </div>
        </div>
      )}

      {/* Loading state */}
      {(productsLoading || scoutHistoryLoading) && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <span className="ml-3 text-muted-foreground">
            Loading products and saved scout data...
          </span>
        </div>
      )}

      {/* Product cards */}
      {!productsLoading && !scoutHistoryLoading && productList.length > 0 && (
        <div className="space-y-4">
          {productList.map(product => (
            <ProductScoutCard
              key={product.id}
              result={
                results[product.id] ?? {
                  productId: product.id,
                  productTitle: product.title,
                  productPrice: product.price?.toString() ?? "0",
                  prices: [],
                  totalFound: 0,
                  searchEngine: "none",
                  status: "failed",
                  errorMessage: null,
                  reviews: [],
                  searchQueries: [],
                }
              }
              onScout={() => handleScoutProduct(product.id)}
              isScouting={scoutingIds.has(product.id)}
              onScoutSerpApi={() => handleScoutSerpApi(product.id)}
              isScoutingSerpApi={serpScoutingIds.has(product.id)}
              onScoutExa={() => handleScoutExa(product.id)}
              isScoutingExa={exaScoutingIds.has(product.id)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!productsLoading && !scoutHistoryLoading && productList.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground">
          <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No products to scout</p>
          <p className="text-xs mt-1">
            Add products first, then come back to scout competitor prices.
          </p>
        </div>
      )}

      {/* Info card */}
      <div className="glass-panel rounded-lg p-4 border border-outline-variant/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-[12px]">
              How Price Scout works
            </p>
            <p>
              • <strong>Firecrawl</strong> searches Google for each product and
              extracts prices from the top 10 results
            </p>
            <p>
              • <strong>Exa</strong> uses neural search to find product pages
              and extract structured pricing data with AI — often in one call
            </p>
            <p>
              • <strong>SerpAPI</strong> is used as a fallback search engine if
              Firecrawl/Exa are unavailable
            </p>
            <p>
              • <strong>SerpAPI Batch</strong> runs 5 searches per product
              (name, price, review, buy, best deal) and stores results in the
              database
            </p>
            <p>
              • <strong>Direct fetch</strong> is used as a last resort to scrape
              prices from HTML
            </p>
            <p>
              • Prices are compared against your product price to show market
              position
            </p>
            <p>• Requires a valid Firecrawl, Exa, or SerpAPI API key</p>
          </div>
        </div>
      </div>
    </div>
  );
}
