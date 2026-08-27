import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import {
  Download,
  Search,
  Package,
  Database,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import AddProductDialog from "./AddProductDialog";
import { cn } from "@/lib/utils";
import { useMemo, useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import Papa from "papaparse";
import { toast } from "sonner";

// ─── Market Position Badge ───────────────────────────────────────────────────

type MarketPositionStatus =
  | "LEADING"
  | "COMPETITIVE"
  | "OVERPRICED"
  | "INSUFFICIENT_DATA";

type MarketAnalysis = NonNullable<RouterOutputs["pricingEngine"]["analyze"]>;

const POSITION_STYLES: Record<
  MarketPositionStatus,
  { bg: string; text: string; border: string }
> = {
  LEADING: {
    bg: "bg-[var(--success)]/10",
    text: "text-[var(--success)]",
    border: "border-[var(--success)]/30",
  },
  COMPETITIVE: {
    bg: "bg-secondary",
    text: "text-secondary-foreground",
    border: "border-secondary",
  },
  OVERPRICED: {
    bg: "bg-[var(--destructive)]/15",
    text: "text-[var(--destructive)]",
    border: "border-[var(--destructive)]/30",
  },
  INSUFFICIENT_DATA: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  },
};

const POSITION_LABELS: Record<MarketPositionStatus, string> = {
  LEADING: "Cheaper than them",
  COMPETITIVE: "About the same",
  OVERPRICED: "Dearer than them",
  INSUFFICIENT_DATA: "Not checked yet",
};

/** The badge is a verdict; this says what it is a verdict about. */
const POSITION_TITLES: Record<MarketPositionStatus, string> = {
  LEADING: "Your price is more than 3% below the average of the shops we found",
  COMPETITIVE: "Your price is within 3% of the average of the shops we found",
  OVERPRICED: "Your price is more than 3% above the average of the shops we found",
  INSUFFICIENT_DATA: "We have not found enough shops to compare against",
};

function MarketPositionBadge({
  position,
  isLoading,
}: {
  position?: MarketAnalysis["position"] | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-full border border-border bg-surface-container-highest px-2 py-0.5 text-[13px] text-muted-foreground">
        Checking\u2026
      </span>
    );
  }

  if (!position) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[13px] text-muted-foreground">
        Not checked yet
      </span>
    );
  }

  const status = position.status as MarketPositionStatus;
  const style = POSITION_STYLES[status] ?? POSITION_STYLES.INSUFFICIENT_DATA;
  const label = POSITION_LABELS[status] ?? "N/A";

  return (
    <span
      title={POSITION_TITLES[status] ?? POSITION_TITLES.INSUFFICIENT_DATA}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-[13px] font-semibold border",
        style.bg,
        style.text,
        style.border
      )}
    >
      {label}
    </span>
  );
}

/** Why a product has no reading, in words rather than a dash. */
const OUTCOME_REASONS: Record<string, string> = {
  "no confident matches": "Nobody found selling the same thing",
  "no candidates found": "No shops found for this",
  "already priced about right": "Priced about right",
};

type ProductAnalysis = RouterOutputs["pricingEngine"]["analyzeAll"][number];

function MarketInsightCells({
  analysis,
  isLoading,
  outcome,
}: {
  analysis?: ProductAnalysis;
  isLoading: boolean;
  outcome?: { matched: number; skipped: string | null; failed: boolean };
}) {
  const data = analysis;
  const marketLow = data?.marketSnapshot.lowestCompetitorPrice;
  const delta = data?.position.priceDiff;

  if (isLoading) {
    return (
      <>
        <TableCell className="hidden py-3 text-right sm:table-cell">
          <span className="inline-block h-4 w-14 animate-pulse rounded bg-muted" />
        </TableCell>
        <TableCell className="hidden py-3 text-center sm:table-cell">
          <span className="inline-block h-4 w-12 animate-pulse rounded bg-muted" />
        </TableCell>
        <TableCell className="py-3 text-center align-middle">
          <MarketPositionBadge isLoading />
        </TableCell>
      </>
    );
  }

  return (
    <>
      <TableCell className="hidden py-3 text-right font-mono text-[14px] text-muted-foreground sm:table-cell">
        {marketLow != null ? `$${marketLow.toFixed(2)}` : "—"}
      </TableCell>
      <TableCell
        className="hidden py-3 text-center sm:table-cell"
        title="Difference versus average competitor price"
      >
        {delta != null ? (
          <span
            className={cn(
              "font-mono text-[13px]",
              delta > 0
                ? "text-[var(--destructive)]"
                : delta < 0
                  ? "text-[var(--success)]"
                  : "text-muted-foreground"
            )}
          >
            {delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)}
          </span>
        ) : (
          <span className="font-mono text-[13px] text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-3 text-center align-middle">
        {data?.position && data.position.status !== "INSUFFICIENT_DATA" ? (
          <MarketPositionBadge position={data.position} isLoading={false} />
        ) : (
          <span className="text-[13px] text-muted-foreground">
            {outcome?.failed
              ? "Could not be checked"
              : outcome?.skipped
                ? (OUTCOME_REASONS[outcome.skipped] ?? outcome.skipped)
                : "Not checked yet"}
          </span>
        )}
      </TableCell>
    </>
  );
}

export default function Products() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  // The Overview's four counts link here rather than being dead ends.
  const [standFilter, setStandFilter] = useState<string>(() => {
    const stand = new URLSearchParams(window.location.search).get("stand");
    return stand && stand in POSITION_LABELS ? stand : "all";
  });
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState("");
  const priceInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: outcomes } = trpc.pipeline.productOutcomes.useQuery(undefined, {
    staleTime: 1000 * 30,
  });
  const { data: analyses, isLoading: analysisLoading } =
    trpc.pricingEngine.analyzeAll.useQuery(undefined, {
      staleTime: 1000 * 60 * 2,
    });
  const analysisByProduct = useMemo(
    () => new Map((analyses ?? []).map(a => [a.productId, a])),
    [analyses]
  );
  const {
    data: allProducts,
    isLoading,
    refetch,
    error,
  } = trpc.products.list.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

  const updateProductMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      toast.success("Price updated");
      setEditingPriceId(null);
      refetch();
      // A CSV import starts a run too; nudge the indicator to notice now.
      utils.pipeline.status.invalidate();
    },
    onError: () => {
      toast.error("Failed to update price");
    },
  });

  const startEditing = useCallback(
    (productId: string, currentPrice: string) => {
      setEditingPriceId(productId);
      setEditingPriceVal(currentPrice);
      setTimeout(() => priceInputRef.current?.focus(), 50);
    },
    []
  );

  const savePrice = useCallback(
    (productId: string) => {
      const num = parseFloat(editingPriceVal);
      if (isNaN(num) || num <= 0) {
        toast.error("Enter a valid price");
        return;
      }
      updateProductMutation.mutate({ id: productId, price: editingPriceVal });
    },
    [editingPriceVal, updateProductMutation]
  );

  const products = useMemo(() => allProducts ?? [], [allProducts]);
  const categories = useMemo(
    () =>
      Array.from(
        new Set(products.map(p => p.category).filter(Boolean))
      ) as string[],
    [products]
  );

  const filtered = useMemo(() => {
    return products.filter(p => {
      const ms =
        !searchQuery ||
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      const mc = categoryFilter === "all" || p.category === categoryFilter;
      const stand =
        standFilter === "all" ||
        (analysisByProduct.get(p.id)?.position.status ?? "INSUFFICIENT_DATA") ===
          standFilter;
      return ms && mc && stand;
    });
  }, [products, searchQuery, categoryFilter, standFilter, analysisByProduct]);

  const handleExport = useCallback(() => {
    if (!filtered.length) {
      toast.error("No products to export");
      return;
    }
    const rows = filtered.map(p => ({
      Title: p.title,
      SKU: p.sku ?? "",
      Category: p.category ?? "",
      Price: Number(p.price).toFixed(2),
      Status: p.status,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `priceintel-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} products`);
  }, [filtered]);

  // ── CSV import ─────────────────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const importCsv = trpc.products.importCsv.useMutation({
    onSuccess: result => {
      toast.success(result.message);
      if (result.skipped > 0) {
        toast.warning(
          `${result.skipped} row(s) skipped. First problem: ${result.errors[0]?.reason ?? "unknown"}`
        );
      }
      refetch();
    },
    onError: err => toast.error(err.message),
    onSettled: () => setImporting(false),
  });

  const handleCsvFile = useCallback(
    async (file: File) => {
      setImporting(true);
      const text = await file.text();
      importCsv.mutate({ csv: text });
    },
    [importCsv]
  );

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Your products"
          title="Your products"
          description="Failed to load products. Please try again."
          icon={Package}
        />
        <div className="glass-card rounded-2xl p-8 text-center sm:p-12">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Package className="size-5" />
          </div>
          <p className="mb-3 text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton />;

  if (products.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Your products"
          title="Your products"
          description="No products tracked yet. Start by connecting your Shopify store."
          icon={Package}
        />
        <Empty>
          <EmptyMedia variant="icon">
            <Package className="h-6 w-6" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No products yet</EmptyTitle>
            <EmptyDescription>
              Sync your Shopify catalog to start monitoring prices and tracking
              competitor movements.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <a
              href="/api/shopify/login"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.72rem] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-button)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/90 hover:shadow-[var(--shadow-button-hover)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 active:translate-y-0"
            >
              <Database className="size-4" />
              Connect Shopify Store
            </a>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Your products"
        title="Your products"
        description={
          <>
            {products.length} products, and how each one&apos;s price compares
            to the shops selling the same thing.
          </>
        }
        icon={Package}
      >
        <div className="hidden shrink-0 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground sm:block">
          <span className="data-value text-foreground">{products.length}</span>{" "}
          active listings
        </div>
      </PageHeader>

      {/* Filter Bar */}
      <div className="surface-toolbar flex flex-wrap items-center gap-2.5 p-3">
        <div className="relative w-full flex-1 sm:min-w-[200px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="search-products"
            placeholder="Search products or SKUs..."
            aria-label="Search products or SKUs"
            className="h-11 bg-surface-container pl-9"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-11 w-full bg-surface-container sm:w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-11"
          onClick={handleExport}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleCsvFile(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-11"
          disabled={importing}
          onClick={() => csvInputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {importing ? "Importing..." : "Import CSV"}
        </Button>
        <AddProductDialog onSuccess={() => refetch()} />
        {standFilter !== "all" && (
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[13px] font-medium text-primary"
            onClick={() => setStandFilter("all")}
          >
            Showing only: {POSITION_LABELS[standFilter as MarketPositionStatus]}
            <span aria-hidden="true">&times;</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/70 bg-surface-container-high">
                <TableHead className="pl-5 label-caps font-normal text-muted-foreground">
                  Product
                </TableHead>
                <TableHead className="min-w-[140px] label-caps font-normal text-muted-foreground">
                  SKU
                </TableHead>
                <TableHead className="text-right label-caps font-normal text-muted-foreground">
                  Price
                </TableHead>
                <TableHead className="hidden text-right label-caps font-normal text-muted-foreground sm:table-cell">
                  Cheapest shop we found
                </TableHead>
                <TableHead className="hidden text-center label-caps font-normal text-muted-foreground sm:table-cell">
                  You vs. their average
                </TableHead>
                <TableHead className="text-center label-caps font-normal text-muted-foreground">
                  Where you stand
                </TableHead>
                <TableHead className="pr-5 text-right label-caps font-normal text-muted-foreground">
                  &nbsp;
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {filtered.length > 0 ? (
                filtered.map(product => {
                  return (
                    <TableRow
                      key={product.id}
                      className="transition-colors hover:bg-surface-container-low"
                    >
                      <TableCell className="py-3 pl-5">
                        <div className="flex items-center gap-3">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              className="size-10 rounded-xl border border-border object-cover shadow-sm"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-xl border border-outline-variant bg-surface-container-highest text-xs font-bold text-muted-foreground shadow-sm">
                              {product.title.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="max-w-[240px] truncate text-sm font-semibold leading-5">
                              {product.title}
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              {product.category || "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-left font-mono text-[13px] text-muted-foreground">
                        {product.sku || "—"}
                      </TableCell>
                      <TableCell className="py-3 text-right align-middle">
                        {editingPriceId === product.id ? (
                          <Input
                            ref={priceInputRef}
                            value={editingPriceVal}
                            onChange={e => setEditingPriceVal(e.target.value)}
                            onBlur={() => savePrice(product.id)}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                              if (e.key === "Escape") {
                                setEditingPriceId(null);
                              }
                            }}
                            className="h-10 w-24 bg-surface-container text-right font-mono text-[14px]"
                          />
                        ) : (
                          <button
                            type="button"
                            aria-label={"Edit price for " + product.title}
                            className="inline-flex min-h-11 items-center rounded-lg px-2 font-mono text-[14px] font-medium transition-[background-color,color] hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 cursor-text"
                            onClick={() =>
                              startEditing(product.id, product.price)
                            }
                          >
                            ${Number(product.price).toFixed(2)}
                          </button>
                        )}
                      </TableCell>
                      <MarketInsightCells
                        analysis={analysisByProduct.get(product.id)}
                        isLoading={analysisLoading}
                        outcome={outcomes?.[product.id]}
                      />
                      <TableCell className="py-3 pr-5 text-right align-middle">
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border border-outline-variant px-3 text-[13px] font-medium transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
                          title="Every shop we looked at for this product, and what we suggest charging"
                          onClick={() => navigate(`/products/${product.id}`)}
                        >
                          See the workings
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-16 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <p>No products match your filters</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-outline-variant"
                        onClick={() => {
                          setSearchQuery("");
                          setCategoryFilter("all");
                        }}
                      >
                        <RotateCcw className="h-3 w-3 mr-1.5" />
                        Clear Filters
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
import { PageHeader } from "@/components/workspace/PageHeader";
