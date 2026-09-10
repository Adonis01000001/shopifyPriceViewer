import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { usePipelineRun } from "@/hooks/usePipelineRun";
import { recommendationFacts } from "@/lib/recommendation-facts";
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
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { PricingDashboardSummary } from "@/components/dashboard/PricingRecommendationWidget";
import { UpgradePrompt } from "@/components/dashboard/UpgradePrompt";
import { useProductAnalytics } from "@/lib/analytics";
import { getStoreDashboardPath, useShopContext } from "@/contexts/ShopContext";
import { formatPrice } from "@/lib/price";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const { selectedShopId, selectedShop } = useShopContext();
  const navigateToStore = (path: string) =>
    setLocation(selectedShopId ? getStoreDashboardPath(selectedShopId, path) : path);
  const utils = trpc.useUtils();
  const run = usePipelineRun(selectedShopId ?? undefined);
  const { data: outcomes } = trpc.pipeline.productOutcomes.useQuery(
    selectedShopId ? { storeId: selectedShopId } : undefined,
    { staleTime: 1000 * 20, enabled: !!selectedShopId }
  );
  const [pushTarget, setPushTarget] = useState<{
    id: string;
    title: string;
    from: string;
    to: string;
  } | null>(null);
  const { data: products } = trpc.products.list.useQuery(selectedShopId ? { storeId: selectedShopId } : undefined);
  // A persisted recommendation is the source for actions, but the pricing
  // engine can still calculate a current suggestion from the store's live
  // competitor prices. This matters for products added before a recommendation
  // snapshot was generated (and keeps the table from incorrectly saying
  // "Keep as is").
  const { data: liveAnalyses, isLoading: liveAnalysesLoading } =
    trpc.pricingEngine.analyzeAll.useQuery(
      selectedShopId ? { storeId: selectedShopId } : undefined,
      {
        staleTime: 1000 * 60 * 2,
        enabled: !!selectedShopId,
      }
    );
  const liveAnalysisByProduct = useMemo(
    () =>
      new Map<string, RouterOutputs["pricingEngine"]["analyzeAll"][number]>(
        (liveAnalyses ?? []).map(analysis => [analysis.productId, analysis])
      ),
    [liveAnalyses]
  );
  const { data: productStats } = trpc.products.stats.useQuery(selectedShopId ? { storeId: selectedShopId } : undefined);
  const { data: competitorStats } = trpc.competitors.stats.useQuery(selectedShopId ? { storeId: selectedShopId } : undefined);
  const { data: alertStats } = trpc.alerts.stats.useQuery(selectedShopId ? { storeId: selectedShopId } : undefined);
  const { data: actionCenter } = trpc.intelligence.actionCenter.useQuery(selectedShopId ? { storeId: selectedShopId } : undefined);
  const { data: accountUsage } = trpc.account.usage.useQuery();
  const { data: user } = trpc.auth.me.useQuery();
  const track = useProductAnalytics();
  const firstValueTracked = useRef(false);
  const dashboardViewTracked = useRef(false);
  const isAdmin = user?.role === "admin";
  // Admins see all pending recommendations; regular users see only their own
  const adminQuery = trpc.recommendations.listAll.useQuery(
    { status: "pending", limit: 200, storeId: selectedShopId ?? undefined },
    { enabled: isAdmin }
  );
  // The table lists every product, so it needs every pending suggestion. At 6
  // the seventh onward silently read as "nothing to do" when there was.
  const userQuery = trpc.recommendations.list.useQuery(
    { status: "pending", limit: 200, storeId: selectedShopId ?? undefined },
    { enabled: !isAdmin }
  );
  const adminRecommendations = adminQuery.data;
  const userRecommendations = userQuery.data;
  const recommendations = useMemo(
    () => (isAdmin ? (adminRecommendations ?? []) : (userRecommendations ?? [])),
    [isAdmin, adminRecommendations, userRecommendations]
  );
  const { data: notifications } = trpc.alerts.list.useQuery({
    unreadOnly: true,
    limit: 6,
    storeId: selectedShopId ?? undefined,
  });
  const implementRecommendation = trpc.recommendations.implement.useMutation({
    onSuccess: result => {
      utils.recommendations.list.invalidate();
      utils.recommendations.stats.invalidate();
      utils.products.list.invalidate();
      utils.intelligence.actionCenter.invalidate();
      const pushed = (result as { pushed?: { newPrice: number } | null })?.pushed;
      toast.success(
        pushed
          ? `Price updated in Shopify: $${pushed.newPrice.toFixed(2)}`
          : "Taken off your list. Your shop was not changed."
      );
    },
    onError: err => toast.error(err.message),
  });
  const generateRecommendation =
    trpc.pricingEngine.generateRecommendation.useMutation({
      onSuccess: result => {
        if (result.success) {
          void utils.recommendations.list.invalidate(
            selectedShopId ? { storeId: selectedShopId } : undefined
          );
        }
      },
    });
  const dismissRecommendation = trpc.recommendations.dismiss.useMutation({
    onSuccess: () => {
      utils.recommendations.list.invalidate();
      utils.recommendations.stats.invalidate();
      utils.intelligence.actionCenter.invalidate();
      toast.success("Hidden. Your shop was not changed.");
    },
  });
  const markAlertRead = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      utils.alerts.stats.invalidate();
      utils.intelligence.actionCenter.invalidate();
    },
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
  // Every product belongs on this list. Showing only the ones we solved made
  // the rest look lost — a merchant could not tell "still working" from
  // "nothing found" from "not imported". Actionable ones sort to the top,
  // biggest saving first; everything else follows with its reason.
  const recommendationByProduct = useMemo(() => {
    const map = new Map<string, (typeof recommendations)[number]>();
    for (const rec of recommendations ?? []) {
      if (!map.has(rec.productId)) map.set(rec.productId, rec);
    }
    return map;
  }, [recommendations]);

  const pricingRows = useMemo(() => {
    const rows = allProducts.map(product => {
      const recommendation = recommendationByProduct.get(product.id) ?? null;
      const liveAnalysis = liveAnalysisByProduct.get(product.id);
      const liveRecommendation = liveAnalysis?.recommendation;
      const suggestion = recommendation ??
        (liveAnalysis && liveRecommendation
          ? {
              currentPrice: liveAnalysis.marketSnapshot.merchantPrice,
              recommendedPrice: liveRecommendation.recommendedPrice,
              marginProtectionApplied:
                liveRecommendation.marginProtectionApplied,
              factors: {
                competitorCount: liveAnalysis.marketSnapshot.competitorCount,
                avgCompetitorPrice:
                  liveAnalysis.marketSnapshot.avgCompetitorPrice,
                minimumAllowedPrice: liveRecommendation.minimumAllowedPrice,
              },
            }
          : null);
      const facts = suggestion
        ? recommendationFacts({
            currentPrice: suggestion.currentPrice,
            recommendedPrice: suggestion.recommendedPrice,
            costPrice: product.costPrice,
            marginProtectionApplied: suggestion.marginProtectionApplied,
            factors: suggestion.factors,
          })
        : null;
      const actionable = !!facts && !facts.needsACloserLook;
      return {
        product,
        recommendation,
        suggestion,
        facts,
        actionable,
        outcome: outcomes?.[product.id],
      };
    });

    return rows.sort((left, right) => {
      if (left.actionable !== right.actionable) return left.actionable ? -1 : 1;
      const leftMoney = left.facts?.changeAmount ?? -1;
      const rightMoney = right.facts?.changeAmount ?? -1;
      if (leftMoney !== rightMoney) return rightMoney - leftMoney;
      return left.product.title.localeCompare(right.product.title);
    });
  }, [allProducts, liveAnalysisByProduct, recommendationByProduct, outcomes]);
  const notificationItems = notifications ?? [];

  const openPriceChangeConfirmation = async (input: {
    productId: string;
    title: string;
    recommendationId?: string;
    currentPrice: number;
    recommendedPrice: number;
  }) => {
    if (generateRecommendation.isPending || implementRecommendation.isPending) {
      return;
    }

    try {
      let recommendationId = input.recommendationId;
      let currentPrice = input.currentPrice;
      let recommendedPrice = input.recommendedPrice;

      // Live analysis is intentionally read-only. Persist the canonical
      // recommendation only after the merchant asks to change the price, so
      // the existing Shopify confirmation/authorization path can be reused.
      if (!recommendationId) {
        const result = await generateRecommendation.mutateAsync({
          productId: input.productId,
          storeId: selectedShopId ?? undefined,
        });
        if (!result.success || !result.recommendation) {
          throw new Error(
            result.message ?? "Could not prepare this price recommendation."
          );
        }
        recommendationId = result.recommendation.id;
        currentPrice = Number(result.recommendation.currentPrice);
        recommendedPrice = Number(result.recommendation.recommendedPrice);
      }

      setPushTarget({
        id: recommendationId,
        title: input.title,
        from: currentPrice.toFixed(2),
        to: recommendedPrice.toFixed(2),
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not prepare this price recommendation."
      );
    }
  };

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
      <PageHeader
        eyebrow="Today"
        title="Overview"
        description="What changed since you last looked, and the price changes worth making today."
      >
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Checked once a day
        </div>
      </PageHeader>

      {/* Merchant-first action center: one obvious decision before the metrics. */}
      <section className="glass-panel rounded-xl border-primary/25 bg-primary/[0.06] p-5 shadow-[0_18px_50px_-36px_var(--primary)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-2 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-primary">
                Start here
              </p>
              <h3 className="mt-1 text-[15px] font-semibold">
                {topRecommendation
                  ? topRecommendation.productTitle
                  : topAlert
                    ? topAlert.title
                    : topMovement
                      ? `${topMovement.competitorName} moved on ${topMovement.productTitle}`
                      : totalProducts === 0
                        ? "Connect your store to get your first pricing signal"
                        : "Your pricing workspace is ready for a competitor scan"}
              </h3>
              <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
                {topRecommendation
                  ? (() => {
                      const from = Number(topRecommendation.currentPrice);
                      const to = Number(topRecommendation.recommendedPrice);
                      const verb = to < from ? "Drop" : "Raise";
                      return `${verb} it from $${from.toFixed(2)} to $${to.toFixed(2)}, based on what other shops are charging.`;
                    })()
                  : topAlert
                    ? topAlert.message
                    : topMovement
                      ? `Detected ${changesLast24Hours} competitor movement${changesLast24Hours === 1 ? "" : "s"} in the last 24 hours.`
                      : "Nothing needs a decision right now. We check every day and this fills in when something changes."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
            onClick={() =>
              navigateToStore(
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
            <div className="bg-[var(--color-tertiary,var(--success))]/15 p-1.5 rounded">
              <DollarSign className="h-5 w-5 text-[var(--color-tertiary,var(--success))]" />
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
            <div className="bg-[var(--destructive)]/15 p-1.5 rounded">
              <AlertTriangle className="h-5 w-5 text-[var(--destructive)]" />
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
            <div className="bg-[var(--color-secondary,var(--primary))]/15 p-1.5 rounded">
              <Users className="h-5 w-5 text-[var(--color-secondary,var(--primary))]" />
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

      {/* The decision list, full width */}
      <div>
        <div>
          <div className="glass-panel rounded-lg overflow-hidden">
            <div className="px-5 py-4 bg-surface-container/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <LineChart className="h-4 w-4 text-primary" />
                <h3 className="text-[15px] font-semibold">What to do about your prices</h3>
              </div>

            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container/30 label-caps text-muted-foreground">
                    <th className="px-5 py-3 font-normal">Product</th>
                    <th className="px-5 py-3 font-normal">You charge</th>
                    <th className="px-5 py-3 font-normal">We suggest</th>
                    <th className="px-5 py-3 font-normal text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {pricingRows.length > 0 ? (
                    pricingRows.map(row => {
                      const { product, facts, outcome, suggestion } = row;
                      const insight = row.recommendation;
                      const recommendedPrice = suggestion
                        ? Number(suggestion.recommendedPrice)
                        : null;
                      return (
                        <tr
                          key={product.id}
                          className="transition-colors hover:bg-surface-container-low"
                        >
                          <td className="px-5 py-3 min-w-[16rem]">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 w-9 h-9 shrink-0 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-xs font-bold text-muted-foreground">
                                {(product?.title ?? "P").charAt(0)}
                              </div>
                              <div>
                                <p className="text-[14px] font-medium">
                                  {product?.title ?? "Tracked product"}
                                </p>
                                <p className="text-[13px] leading-snug text-muted-foreground">
                            {!facts ? (
                              outcome?.failed ? (
                                <>We could not check this one. It will be tried again tomorrow.</>
                              ) : outcome?.skipped === "already priced about right" ? (
                                <>Your price already sits where the market is.</>
                              ) : outcome?.skipped === "no confident matches" ? (
                                <>We found shops but none selling this exact item.</>
                              ) : outcome?.skipped === "no candidates found" ? (
                                <>No shops found selling this yet.</>
                              ) : run.running ? (
                                <>Waiting to be checked.</>
                              ) : (
                                <>Not checked yet.</>
                              )
                            ) : facts.heldAtFloor ? (
                              <>
                                Your cost sets the floor here. Rivals average $
                                {facts.avgCompetitorPrice?.toFixed(2) ?? "—"},
                                but going below your floor would break your
                                margin rule.
                              </>
                            ) : facts.direction === "rise" ? (
                              <>
                                You are under the market. Other shops average $
                                {facts.avgCompetitorPrice?.toFixed(2) ?? "—"}.
                              </>
                            ) : (
                              <>
                                Other shops average $
                                {facts.avgCompetitorPrice?.toFixed(2) ?? "—"}.
                                This sits just under them.
                              </>
                            )}
                            {facts?.marginPercent != null && (
                              <>
                                {" "}
                                Leaves you {Math.round(facts.marginPercent)}%
                                margin.
                              </>
                            )}
                            {facts?.floorPrice != null &&
                              facts.floorPrice > 0 &&
                              facts.costPrice != null && (
                                <span
                                  className="mt-1 block text-[12px] text-muted-foreground/80"
                                  title="Your margin rule, applied to this product's cost"
                                >
                                  Your floor: $
                                  {facts.costPrice.toFixed(2)} cost &rarr; never
                                  below ${facts.floorPrice.toFixed(2)}
                                </span>
                              )}
                            {facts?.needsACloserLook && (
                              <span className="mt-1 block font-medium text-[var(--destructive)]">
                                Only {facts.sources} shop
                                {facts.sources === 1 ? "" : "s"} found, and it
                                sits far above you. We would rather wait for
                                more before suggesting a price.
                              </span>
                            )}
                          </p>
                                <p className="mt-0.5 text-[12px] text-muted-foreground/80">
                                  {!facts
                                    ? product.sku || ""
                                    : facts.sources === 0
                                      ? "no shops confirmed"
                                      : `based on ${facts.sources} shop${facts.sources === 1 ? "" : "s"}`}
                                  {facts?.evidence === "thin" &&
                                    " · only one, so treat it carefully"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono text-[14px] font-medium">
                            {formatPrice(product.price, product.currency ?? "USD")}
                          </td>
                          <td className="px-5 py-3">
                            {!facts ? (
                              <span className="text-[13px] text-muted-foreground">
                                {(run.running || liveAnalysesLoading) && !outcome
                                  ? "Checking\u2026"
                                  : "Keep as is"}
                              </span>
                            ) : facts.needsACloserLook ? (
                              <span className="text-[13px] text-muted-foreground">
                                Not enough to go on yet
                              </span>
                            ) : (
                              <>
                                <span
                                  className={cn(
                                    "font-mono text-[14px] font-semibold",
                                    facts.direction === "rise"
                                      ? "text-[var(--warning,var(--destructive))]"
                                      : "text-primary"
                                  )}
                                >
                                  ${recommendedPrice?.toFixed(2) ?? "—"}
                                </span>
                                <span className="ml-1.5 text-[12px] text-muted-foreground">
                                  {facts.direction === "rise"
                                    ? `up ${Math.round(facts.changePercent)}%`
                                    : facts.direction === "cut"
                                      ? `down ${Math.round(facts.changePercent)}%`
                                      : "no change"}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {suggestion && facts ? (
                              <div className="flex flex-col items-end gap-1.5">
                                <button
                                  type="button"
                                  className="w-full max-w-[10.5rem] whitespace-nowrap rounded bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                                  title="Writes this price to your live Shopify store"
                                  onClick={() =>
                                    void openPriceChangeConfirmation({
                                      productId: product.id,
                                      title: product?.title ?? "this product",
                                      recommendationId: insight?.id,
                                      currentPrice: Number(suggestion.currentPrice),
                                      recommendedPrice: Number(suggestion.recommendedPrice),
                                    })
                                  }
                                  disabled={
                                    facts.needsACloserLook ||
                                    generateRecommendation.isPending ||
                                    dismissRecommendation.isPending ||
                                    implementRecommendation.isPending
                                  }
                                >
                                  {generateRecommendation.isPending && !insight
                                    ? "Preparing…"
                                    : "Change the price"}
                                </button>
                                {insight ? (
                                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                                    <button
                                      type="button"
                                      className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                                      title="Takes it off this list. Your store is not touched."
                                      onClick={() =>
                                        implementRecommendation.mutate({
                                          id: insight.id,
                                          storeId: selectedShopId ?? undefined,
                                        })
                                      }
                                      disabled={
                                        dismissRecommendation.isPending ||
                                        implementRecommendation.isPending
                                      }
                                    >
                                      I&apos;ll do it myself
                                    </button>
                                    <span aria-hidden="true">&middot;</span>
                                    <button
                                      type="button"
                                      className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                                      title="Hides this suggestion. Your store is not touched, and it may come back tomorrow if the market moves."
                                      onClick={() =>
                                        dismissRecommendation.mutate({
                                          id: insight.id,
                                          storeId: selectedShopId ?? undefined,
                                        })
                                      }
                                      disabled={
                                        dismissRecommendation.isPending ||
                                        implementRecommendation.isPending
                                      }
                                    >
                                      Ignore
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[12px] text-muted-foreground">
                                    Calculated from current competitor prices
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="text-right text-[13px] text-muted-foreground">
                                Nothing to do
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-muted-foreground text-sm"
                      >
                        {run.running
                          ? `${run.progressLabel}. Recommendations appear as each product finishes.`
                          : "Nothing to decide yet. Sync your store and we will work out what to charge."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Competitor Movement Feed */}
        <div className="mt-6">
          <div className="glass-panel rounded-lg flex flex-col">
            <div className="px-5 py-4 bg-surface-container/50 flex items-center gap-3">
              <RefreshCw className="h-4 w-4 text-[var(--success)]" />
              <h3 className="text-[15px] font-semibold">Competitor Movement</h3>
            </div>
            <div className="p-3">
              {movementItems.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <p className="font-medium mb-1">
                    {run.running ? "Checking prices now" : "No price changes yet"}
                  </p>
                  <p className="text-xs">
                    {run.running
                      ? `${run.progressLabel}.`
                      : "We re-check every competitor once a day. When one of them moves a price, it shows up here."}
                  </p>
                </div>
              ) : movementItems.length > 0 ? (
                <div className="space-y-0.5 max-h-[320px] overflow-y-auto">
                  {movementItems.map(item => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-container-low"
                    >
                      <div
                        className={cn(
                          "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          item.type === "price_drop"
                            ? "bg-primary/[0.12]"
                            : item.type === "price_increase"
                              ? "bg-[var(--destructive)]/15"
                              : "bg-[var(--color-secondary,var(--primary))]/15"
                        )}
                      >
                        {item.type === "price_drop" ? (
                          <TrendingDown className="h-3.5 w-3.5 text-primary" />
                        ) : item.type === "price_increase" ? (
                          <TrendingUp className="h-3.5 w-3.5 text-[var(--destructive)]" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 text-[var(--color-secondary,var(--primary))]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium truncate leading-tight">
                          {item.productTitle}
                        </p>
                        <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
                          <span className="text-muted-foreground/70">
                            {item.competitorName}
                          </span>
                          {item.oldPrice && (
                            <>
                              {" · "}
                              <span className="font-mono text-[12px]">
                                ${Number(item.oldPrice).toFixed(2)}
                              </span>{" "}
                              →
                            </>
                          )}{" "}
                          <span
                            className={cn(
                              "font-mono text-[12px] font-medium",
                              item.type === "price_drop"
                                ? "text-primary"
                                : item.type === "price_increase"
                                  ? "text-[var(--destructive)]"
                                  : ""
                            )}
                          >
                            ${Number(item.newPrice).toFixed(2)}
                          </span>
                        </p>
                      </div>
                      <span className="text-[12px] text-muted-foreground/50 shrink-0 mt-0.5">
                        {timeAgo(item.date)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-muted-foreground text-xs text-center">
                  <RefreshCw className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p>Monitoring for price changes...</p>
                  <p className="text-[12px] mt-1 text-muted-foreground/60">
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
        <div className="px-5 py-4 bg-surface-container/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="h-4 w-4 text-[var(--destructive)]" />
            <h3 className="text-[15px] font-semibold">Notifications</h3>
          </div>
          {notificationItems.length > 0 && (
            <span className="label-caps text-[12px] bg-[var(--destructive)]/15 text-[var(--destructive)] px-2 py-0.5 rounded border border-[var(--destructive)]/20">
              {notificationItems.length} unread
            </span>
          )}
        </div>
        {notificationItems.length > 0 ? (
          <div className="divide-y divide-white/[0.03]">
            {notificationItems.map(alert => (
              <div
                key={alert.id}
                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-container-low"
              >
                <div
                  className={cn(
                    "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    alert.severity === "critical" || alert.severity === "high"
                      ? "bg-[var(--destructive)]/15"
                      : "bg-primary/[0.12]"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4",
                      alert.severity === "critical" || alert.severity === "high"
                        ? "text-[var(--destructive)]"
                        : "text-primary"
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium truncate">
                      {alert.title}
                    </p>
                    <Badge
                      className={cn(
                        "label-caps text-[12px] border",
                        alert.severity === "critical"
                          ? "bg-[var(--destructive)]/20 text-[var(--destructive)] border-[var(--destructive)]/30"
                          : alert.severity === "high"
                            ? "bg-[var(--destructive)]/15 text-[var(--destructive)]/80 border-[var(--destructive)]/20"
                            : alert.severity === "medium"
                              ? "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      )}
                    >
                      {alert.severity}
                    </Badge>
                  </div>
                  <p className="text-[13px] text-muted-foreground line-clamp-2 mt-1">
                    {alert.message}
                  </p>
                  <p className="text-[12px] text-muted-foreground/60 mt-1">
                    {timeAgo(alert.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/[0.08] disabled:opacity-50"
                  onClick={() => markAlertRead.mutate({ id: alert.id })}
                  disabled={markAlertRead.isPending}
                  title="Mark as read"
                >
                  <Check className="h-3.5 w-3.5" />
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

      {/* What the app will and will not do on its own */}
      <div className="glass-card rounded-lg p-5">
        <h4 className="text-[15px] font-semibold">
          Nothing here changes your shop on its own
        </h4>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
          Every price above is a suggestion. Your Shopify prices only change
          when you press &ldquo;Change the price&rdquo; on a product and confirm
          it. We check the market once a day and update this list.
        </p>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-primary hover:underline"
          onClick={() => setLocation("/settings")}
        >
          See how a suggested price is worked out
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <AlertDialog
        open={!!pushTarget}
        onOpenChange={open => {
          if (!open) setPushTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the price in your store?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes the new price to Shopify straight away, and shoppers
              will see it. Nothing else about the product changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pushTarget && (
            <div className="rounded-md border border-outline-variant bg-surface-container-lowest px-4 py-3">
              <p className="text-[14px] font-medium">{pushTarget.title}</p>
              <p className="mt-1 font-mono text-[14px]">
                ${pushTarget.from}{" "}
                <span className="text-muted-foreground">&rarr;</span>{" "}
                <span className="font-semibold text-primary">
                  ${pushTarget.to}
                </span>
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the current price</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pushTarget) {
                  implementRecommendation.mutate({
                    id: pushTarget.id,
                    pushToStore: true,
                    storeId: selectedShopId ?? undefined,
                  });
                }
                setPushTarget(null);
              }}
            >
              Change it in Shopify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
import { PageHeader } from "@/components/workspace/PageHeader";
