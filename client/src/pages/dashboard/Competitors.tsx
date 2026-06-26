import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Globe,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Upload,
  Trash2,
  Activity,
  Clock,
  Package,
  Gauge,
  X,
  Search,
  Loader2,
  ExternalLink,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Papa from "papaparse";
import { toast } from "sonner";

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "ACTIVE",
    className: "bg-primary/[0.1] text-primary border border-primary/20",
  },
  inactive: {
    label: "INACTIVE",
    className: "bg-muted text-muted-foreground border border-outline-variant",
  },
  error: {
    label: "ERROR",
    className: "bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30",
  },
};

const competitorSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z
    .string()
    .min(1)
    .max(255)
    .refine(
      v =>
        /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$/.test(
          v
        ),
      { message: "Enter a valid domain" }
    ),
  description: z.string().max(500).optional().default(""),
  logoUrl: z
    .string()
    .url("Must be a valid URL")
    .max(500)
    .optional()
    .or(z.literal("")),
});
type CompetitorFormData = z.infer<typeof competitorSchema>;

interface ParsedRow {
  name: string;
  domain: string;
  description?: string;
  valid: boolean;
  errors: string[];
  rowNumber: number;
}

// ─── Scrape tab content ──────────────────────────────────────────────────────

function ScrapeTab({
  competitorId,
  competitorDomain,
  scrapeQuery: _scrapeQuery,
  setScrapeQuery,
  scrapeMutation,
  scrapedProducts,
  scrapeError: _scrapeError,
  lastScrapeQuery,
  onAddScraped,
  adding,
}: {
  competitorId: string;
  competitorDomain: string;
  scrapeQuery: string;
  setScrapeQuery: (v: string) => void;
  scrapeMutation: any;
  scrapedProducts: any[];
  scrapeError: string | null;
  lastScrapeQuery: string;
  onAddScraped: (item: any) => void;
  adding: boolean;
}) {
  if (scrapedProducts.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Found {scrapedProducts.length} products on {competitorDomain}
          {lastScrapeQuery ? ` for "${lastScrapeQuery}"` : ""}
        </p>
        <div className="rounded border border-outline-variant overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="label-caps text-muted-foreground">
                <TableHead className="pl-3">Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="w-20 text-center pr-3">Add</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-outline-variant/20">
              {scrapedProducts.map((item, i) => (
                <ScrapedProductRow
                  key={i}
                  item={item}
                  onAdd={onAddScraped}
                  adding={adding}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (scrapeMutation.isPending) {
    return (
      <div className="space-y-3 py-8">
        <div className="flex justify-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
        <p className="text-center text-[12px] text-muted-foreground">
          Scraping {competitorDomain}...
          <br />
          <span className="text-[10px]">This may take up to 30 seconds</span>
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-8 text-muted-foreground">
      <Globe className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-[13px] font-medium">No products scraped yet</p>
      <p className="text-[11px] mt-1">
        Enter a search query or leave empty to scrape all products
      </p>
    </div>
  );
}

function ScrapedProductRow({
  item,
  onAdd,
  adding,
}: {
  item: any;
  onAdd: (item: any) => void;
  adding: boolean;
}) {
  return (
    <tr className="hover:bg-white/[0.02]">
      <td className="pl-3 py-2">
        <div className="flex items-center gap-2">
          {item.imageUrl && (
            <img
              src={item.imageUrl}
              alt=""
              className="w-8 h-8 rounded object-cover shrink-0 border border-outline-variant/20"
            />
          )}
          <div className="min-w-0">
            <p className="text-[12px] font-medium truncate max-w-[280px]">
              {item.title}
            </p>
            {item.productUrl && (
              <a
                href={item.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
              >
                View <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      </td>
      <td className="py-2 text-right font-mono text-[12px] font-medium">
        ${Number(item.price).toFixed(2)}
      </td>
      <td className="py-2 pr-3 text-center">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-primary hover:text-primary/80 hover:bg-primary/10"
          onClick={() => onAdd(item)}
          disabled={adding}
        >
          Add
        </Button>
      </td>
    </tr>
  );
}

// ─── Search tab content ──────────────────────────────────────────────────────

function SearchTab({
  searchQuery,
  setSearchQuery: _setSearchQuery,
  searchLoading,
  searchResults,
  onLinkProduct,
  linking,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchLoading: boolean;
  searchResults: any[] | undefined;
  onLinkProduct: (product: any) => void;
  linking: boolean;
}) {
  if (searchLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    );
  }

  if (searchQuery.length < 2) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-[13px] font-medium">Type to search</p>
        <p className="text-[11px] mt-1">
          Search your existing products by name, SKU or category
        </p>
      </div>
    );
  }

  if (searchResults && searchResults.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          {searchResults.length} products found
        </p>
        {searchResults.map(product => (
          <ProductResultRow
            key={product.id}
            product={product}
            onLink={onLinkProduct}
            linking={linking}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="text-center py-8 text-muted-foreground">
      <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-[13px] font-medium">No products found</p>
      <p className="text-[11px] mt-1">Try a different search term</p>
    </div>
  );
}

function ProductResultRow({
  product,
  onLink,
  linking,
}: {
  product: any;
  onLink: (product: any) => void;
  linking: boolean;
}) {
  return (
    <div className="bg-surface-container-lowest rounded border border-outline-variant/10 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
          {product.title.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium truncate">{product.title}</p>
          <p className="text-[10px] text-muted-foreground">
            {product.sku && `SKU: ${product.sku} · `}
            {product.category || "No category"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-[12px] font-medium">
          ${Number(product.price).toFixed(2)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-[11px] text-primary hover:text-primary/80 hover:bg-primary/10 border border-primary/20"
          onClick={() => onLink(product)}
          disabled={linking}
        >
          {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Link"}
        </Button>
      </div>
    </div>
  );
}

// ─── Add Product Dialog ──────────────────────────────────────────────────────

function AddProductDialog({
  competitorId,
  competitorName,
  competitorDomain,
  open,
  onOpenChange,
}: {
  competitorId: string;
  competitorName: string;
  competitorDomain: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<"search" | "scrape">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [scrapeQuery, setScrapeQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const utils = trpc.useUtils();

  // Debounce search query
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // Search existing products
  const { data: searchResults, isLoading: searchLoading } =
    trpc.competitors.searchProducts.useQuery(
      { query: debouncedQuery },
      { enabled: open && tab === "scrape" && debouncedQuery.length >= 2 }
    );

  // Scrape results
  const [scrapedProducts, setScrapedProducts] = useState<any[]>([]);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [lastScrapeQuery, setLastScrapeQuery] = useState("");

  const addProductMutation = trpc.competitors.addProduct.useMutation({
    onSuccess: () => {
      utils.competitors.feed.invalidate();
      utils.competitors.products.invalidate();
      toast.success("Product linked to competitor");
    },
    onError: err => toast.error(err.message || "Failed to add product"),
  });

  const scrapeMutation = trpc.competitors.scrapeProducts.useMutation({
    onSuccess: result => {
      setScrapedProducts(result.products);
      setScrapeError(result.errorMessage);
      setLastScrapeQuery(scrapeQuery);
      if (result.products.length > 0) {
        toast.success(
          `Found ${result.products.length} products on ${competitorDomain}`
        );
      }
    },
    onError: err => {
      setScrapeError(err.message || "Scraping failed");
      setScrapedProducts([]);
    },
  });

  const handleLinkProduct = useCallback(
    (product: any) => {
      addProductMutation.mutate({
        competitorId,
        productId: product.id,
        price: product.price,
        currency: product.currency,
        competitorProductTitle: product.title,
        matchScore: 1,
        matchMethod: "manual",
      });
    },
    [addProductMutation, competitorId]
  );

  const handleAddScraped = useCallback(
    (item: any) => {
      addProductMutation.mutate({
        competitorId,
        productId: "00000000-0000-0000-0000-000000000000",
        price: item.price,
        currency: item.currency,
        competitorProductTitle: item.title,
        competitorProductUrl: item.productUrl,
        matchScore: 0.9,
        matchMethod: "scraped",
      });
    },
    [addProductMutation, competitorId]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Add Products to {competitorName}
          </DialogTitle>
          <DialogDescription>
            Link existing products or scrape {competitorDomain} to discover new
            ones.
          </DialogDescription>
        </DialogHeader>

        {/* Tab Switcher */}
        <div className="flex gap-1 p-1 bg-surface-container rounded-lg mb-2">
          <button
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-[12px] font-medium transition-all",
              tab === "search"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("search")}
          >
            <Globe className="h-3.5 w-3.5" />
            Scrape {competitorDomain}
          </button>
          <button
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-[12px] font-medium transition-all",
              tab === "scrape"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("scrape")}
          >
            <Search className="h-3.5 w-3.5" />
            Your Products
          </button>
        </div>

        {/* Tab 1: Scrape Competitor */}
        {tab === "search" && (
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. running shoes, keyboard..."
                  className="pl-9 h-9 bg-surface-container border-outline-variant"
                  value={scrapeQuery}
                  onChange={e => setScrapeQuery(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                onClick={() =>
                  scrapeMutation.mutate({
                    competitorId,
                    searchQuery: scrapeQuery || undefined,
                  })
                }
                disabled={scrapeMutation.isPending}
                className="bg-primary text-primary-foreground hover:brightness-110 shrink-0"
              >
                {scrapeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Globe className="mr-1.5 h-3.5 w-3.5" />
                    Scrape
                  </>
                )}
              </Button>
            </div>

            {scrapeError && scrapedProducts.length === 0 && (
              <div className="rounded border border-[#93000a]/20 bg-[#93000a]/10 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-[#ffb4ab] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] text-[#ffb4ab] font-medium">
                    Scraping failed
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {scrapeError}
                  </p>
                </div>
              </div>
            )}

            <ScrapeTab
              competitorId={competitorId}
              competitorDomain={competitorDomain}
              scrapeQuery={scrapeQuery}
              setScrapeQuery={setScrapeQuery}
              scrapeMutation={scrapeMutation}
              scrapedProducts={scrapedProducts}
              scrapeError={scrapeError}
              lastScrapeQuery={lastScrapeQuery}
              onAddScraped={handleAddScraped}
              adding={addProductMutation.isPending}
            />
          </div>
        )}

        {/* Tab 2: Your Products */}
        {tab === "scrape" && (
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, SKU, or category..."
                className="pl-9 h-9 bg-surface-container border-outline-variant"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <SearchTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchLoading={searchLoading}
              searchResults={searchResults}
              onLinkProduct={handleLinkProduct}
              linking={addProductMutation.isPending}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Feed Panel Component (with polling + price changes) ─────────────────────

function CompetitorFeed({
  competitorId,
  competitorName,
  onClose,
}: {
  competitorId: string;
  competitorName: string;
  onClose: () => void;
}) {
  const {
    data: feed,
    isLoading,
    dataUpdatedAt,
  } = trpc.competitors.feed.useQuery(
    { competitorId },
    { refetchInterval: 15000, refetchIntervalInBackground: false }
  );

  const utils = trpc.useUtils();
  const removeProductMutation = trpc.competitors.removeProduct.useMutation({
    onSuccess: () => {
      utils.competitors.feed.invalidate();
      toast.success("Product removed");
    },
    onError: err => toast.error(err.message || "Failed to remove"),
  });

  const priceHistory = feed?.priceHistory ?? [];
  const scrapeJobs = feed?.scrapeJobs ?? [];
  const activityLog = feed?.activityLog ?? [];
  const products = feed?.products ?? [];

  // Price change detection
  const prevPricesRef = useRef<Record<string, string>>({});
  const priceChanges = useMemo(() => {
    const changes: Record<string, "up" | "down" | "new" | "same"> = {};
    for (const cp of products) {
      const prev = prevPricesRef.current[cp.id];
      if (!prev) {
        changes[cp.id] = "new";
      } else if (prev !== cp.price) {
        changes[cp.id] = Number(cp.price) > Number(prev) ? "up" : "down";
      } else {
        changes[cp.id] = "same";
      }
      prevPricesRef.current[cp.id] = cp.price;
    }
    return changes;
  }, [products]);

  // Live update counter
  const [liveText, setLiveText] = useState("connecting...");
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const update = () => {
      const s = Math.floor((Date.now() - dataUpdatedAt) / 1000);
      if (s < 5) setLiveText("just now");
      else if (s < 60) setLiveText(`${s}s ago`);
      else setLiveText(`${Math.floor(s / 60)}m ago`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  // Merge timeline
  const timeline = useMemo(() => {
    const items: { type: string; date: Date; content: React.ReactNode }[] = [];
    for (const ph of priceHistory) {
      items.push({
        type: "price",
        date: new Date(ph.recordedAt),
        content: (
          <div className="flex items-start gap-2">
            <TrendingDown className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div>
              <span className="text-[11px] text-muted-foreground">
                Price recorded
              </span>
              <p className="text-[12px] font-mono font-medium">
                ${Number(ph.price).toFixed(2)}
              </p>
            </div>
          </div>
        ),
      });
    }
    for (const sj of scrapeJobs) {
      items.push({
        type: "scrape",
        date: new Date(sj.createdAt),
        content: (
          <div className="flex items-start gap-2">
            <Gauge
              className={cn(
                "h-3.5 w-3.5 mt-0.5 shrink-0",
                sj.status === "success"
                  ? "text-primary"
                  : sj.status === "failed"
                    ? "text-[#ffb4ab]"
                    : "text-muted-foreground"
              )}
            />
            <div>
              <span className="text-[11px] text-muted-foreground">
                Scrape {sj.status}
              </span>
              <p className="text-[12px]">
                {sj.productsScraped != null
                  ? `${sj.productsScraped} scraped`
                  : "Started"}
                {sj.productsUpdated != null && sj.productsUpdated > 0
                  ? ` · ${sj.productsUpdated} updated`
                  : ""}
                {sj.errorMessage ? (
                  <span className="text-[#ffb4ab]"> · {sj.errorMessage}</span>
                ) : (
                  ""
                )}
              </p>
            </div>
          </div>
        ),
      });
    }
    for (const al of activityLog) {
      items.push({
        type: "activity",
        date: new Date(al.createdAt),
        content: (
          <div className="flex items-start gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-[11px] text-muted-foreground">
                {al.action}
              </span>
              {al.detail && <p className="text-[12px]">{al.detail}</p>}
            </div>
          </div>
        ),
      });
    }
    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    return items;
  }, [priceHistory, scrapeJobs, activityLog]);

  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex justify-between items-center">
        <div>
          <h3 className="text-[15px] font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            {competitorName} — Live Feed
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {timeline.length} events · {products.length} matched products ·
            updates {liveText}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Price Summary Bar */}
      {products.length > 0 && (
        <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/30 flex items-center gap-4 overflow-x-auto">
          <div className="flex items-center gap-2 px-2.5 py-1 bg-surface-container-highest rounded-full border border-outline-variant shrink-0">
            <Wifi className="h-3 w-3 text-primary" />
            <span className="label-caps text-[9px] text-muted-foreground">
              LIVE
            </span>
          </div>
          {products.slice(0, 4).map(cp => {
            const change = priceChanges[cp.id];
            return (
              <div key={cp.id} className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                  {cp.competitorProductTitle || "Untitled"}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px] font-medium",
                    change === "up"
                      ? "text-[#ffb4ab]"
                      : change === "down"
                        ? "text-primary"
                        : "text-foreground"
                  )}
                >
                  ${Number(cp.price).toFixed(2)}
                </span>
                {change === "up" && (
                  <TrendingUp className="h-3 w-3 text-[#ffb4ab]" />
                )}
                {change === "down" && (
                  <TrendingDown className="h-3 w-3 text-primary" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-outline-variant/20">
        <div className="p-4">
          <h4 className="label-caps text-[10px] text-muted-foreground mb-3 flex items-center gap-1.5">
            <Package className="h-3 w-3" /> Matched Products ({products.length})
          </h4>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 bg-surface-container-lowest rounded animate-pulse"
                />
              ))}
            </div>
          ) : products.length > 0 ? (
            <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
              {products.map(cp => {
                const change = priceChanges[cp.id];
                return (
                  <div
                    key={cp.id}
                    className={cn(
                      "bg-surface-container-lowest rounded p-2.5 border transition-all",
                      change === "up"
                        ? "border-[#ffb4ab]/40 bg-[#93000a]/5"
                        : change === "down"
                          ? "border-primary/40 bg-primary/5"
                          : "border-outline-variant/10"
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <p className="text-[11px] font-medium truncate flex-1 mr-2">
                        {cp.competitorProductTitle || "Untitled"}
                      </p>
                      <button
                        className="text-muted-foreground/40 hover:text-[#ffb4ab] transition-colors shrink-0"
                        onClick={() => setRemoveTarget(cp.id)}
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex justify-between items-center mt-1.5">
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "font-mono text-[11px] font-medium transition-colors",
                            change === "up"
                              ? "text-[#ffb4ab]"
                              : change === "down"
                                ? "text-primary"
                                : "text-foreground"
                          )}
                        >
                          ${Number(cp.price).toFixed(2)}
                        </span>
                        {change === "up" && (
                          <TrendingUp className="h-2.5 w-2.5 text-[#ffb4ab]" />
                        )}
                        {change === "down" && (
                          <TrendingDown className="h-2.5 w-2.5 text-primary" />
                        )}
                      </div>
                      <span className="text-[9px] label-caps text-muted-foreground">
                        {Math.round((cp.matchScore ?? 0) * 100)}% match
                      </span>
                    </div>
                    {cp.competitorProductUrl && (
                      <a
                        href={cp.competitorProductUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-primary hover:underline mt-1 flex items-center gap-0.5"
                      >
                        View product <ExternalLink className="h-2 w-2" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-4">
              No matched products
            </p>
          )}
        </div>

        <div className="lg:col-span-2 p-4">
          <h4 className="label-caps text-[10px] text-muted-foreground mb-3 flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> Activity Timeline
          </h4>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 bg-surface-container-lowest rounded animate-pulse"
                />
              ))}
            </div>
          ) : timeline.length > 0 ? (
            <div className="space-y-0 max-h-[400px] overflow-y-auto">
              {timeline.map((item, i) => (
                <div key={i} className="flex gap-3 pb-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full mt-1.5 shrink-0",
                        item.type === "price"
                          ? "bg-primary"
                          : item.type === "scrape"
                            ? "bg-[#21a732]"
                            : "bg-muted-foreground"
                      )}
                    />
                    {i < timeline.length - 1 && (
                      <div className="w-px flex-1 bg-outline-variant/20 mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-surface-container-lowest rounded p-2.5 border border-outline-variant/10">
                      {item.content}
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1 ml-1">
                      {item.date.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No activity yet</p>
              <p className="text-[10px]">
                Events will appear here as they happen
              </p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={o => {
          if (!o) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Product Link</AlertDialogTitle>
            <AlertDialogDescription>
              Remove this product from the competitor? The price history will be
              preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeProductMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget)
                  removeProductMutation.mutate({
                    competitorProductId: removeTarget,
                  });
                setRemoveTarget(null);
              }}
              disabled={removeProductMutation.isPending}
              className="bg-[#93000a] text-[#ffb4ab] hover:bg-[#93000a]/80"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Competitors Page ───────────────────────────────────────────────────

export default function Competitors() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [feedCompetitor, setFeedCompetitor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [addProductTarget, setAddProductTarget] = useState<{
    id: string;
    name: string;
    domain: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: competitors } = trpc.competitors.list.useQuery();
  const { data: stats } = trpc.competitors.stats.useQuery();
  const utils = trpc.useUtils();

  const createMutation = trpc.competitors.create.useMutation({
    onSuccess: () => {
      utils.competitors.list.invalidate();
      utils.competitors.stats.invalidate();
      toast.success("Competitor added");
    },
    onError: err => toast.error(err.message || "Failed to add"),
  });

  const deleteMutation = trpc.competitors.delete.useMutation({
    onSuccess: () => {
      utils.competitors.list.invalidate();
      utils.competitors.stats.invalidate();
      toast.success("Competitor deleted");
      setDeleteTarget(null);
    },
    onError: err => toast.error(err.message || "Failed to delete"),
  });

  const bulkImportMutation = trpc.competitors.bulkImport.useMutation({
    onSuccess: result => {
      utils.competitors.list.invalidate();
      utils.competitors.stats.invalidate();
      setImportResult({
        imported: result.imported,
        skipped: (importPreview?.length ?? 0) - result.imported,
      });
      toast.success(`Imported ${result.imported}`);
    },
    onError: err => toast.error(err.message || "Import failed"),
    onSettled: () => setImporting(false),
  });

  const form = useForm<CompetitorFormData>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { name: "", domain: "", description: "", logoUrl: "" },
  });
  const allCompetitors = competitors ?? [];

  const chartData = useMemo(
    () =>
      allCompetitors
        .filter(c => c.status === "active")
        .slice(0, 6)
        .map(c => ({
          name: c.name.length > 10 ? c.name.slice(0, 10) + "…" : c.name,
          priceIndex: Number(c.priceIndex),
          avgDiff: Number(c.avgPriceDiff),
        })),
    [allCompetitors]
  );

  const handleAddCompetitor = form.handleSubmit(data => {
    setDialogOpen(false);
    createMutation.mutate({
      ...data,
      description: data.description || undefined,
      logoUrl: data.logoUrl || undefined,
    });
    form.reset();
  });

  const validateRow = (raw: Record<string, string>, rn: number): ParsedRow => {
    const name = (raw.name ?? "").trim();
    const domain = (raw.domain ?? "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    const description =
      raw.description?.trim() || raw.desc?.trim() || undefined;
    const errors: string[] = [];
    if (!name) errors.push("Missing name");
    if (!domain) errors.push("Missing domain");
    if (
      domain &&
      !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$/.test(
        domain
      )
    )
      errors.push(`Invalid domain`);
    return {
      name,
      domain,
      description,
      valid: !errors.length,
      errors,
      rowNumber: rn,
    };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Select a CSV file");
      return;
    }
    setImportResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        const rows = results.data;
        if (!rows.length) {
          toast.error("CSV is empty");
          return;
        }
        if (!("name" in rows[0]) || !("domain" in rows[0])) {
          toast.error("CSV needs 'name' and 'domain' columns");
          return;
        }
        const parsed = rows.map((r, i) => validateRow(r, i + 2));
        if (!parsed.filter(r => r.valid).length) {
          toast.error("No valid rows");
          return;
        }
        if (parsed.length - parsed.filter(r => r.valid).length > 0)
          toast.warning("Some rows have errors");
        setImportPreview(parsed);
      },
      error: () => toast.error("Failed to parse CSV"),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    const vr = importPreview.filter(r => r.valid);
    if (!vr.length) return;
    setImporting(true);
    setImportResult(null);
    bulkImportMutation.mutate({
      competitors: vr.map(r => ({
        name: r.name,
        domain: r.domain,
        description: r.description,
      })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">
          Market Dominance
        </h2>
        <p className="text-muted-foreground text-sm">
          Real-time intelligence across {allCompetitors.length} tracked
          competitors.
        </p>
      </div>

      {/* Bento Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {allCompetitors.length > 0 ? (
          allCompetitors.slice(0, 4).map((comp, i) => (
            <div
              key={comp.id}
              className={cn(
                "glass-card p-5",
                i === 0 && "md:col-span-2 border-l-4 border-l-[#ffb4ab]"
              )}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-surface-container-highest rounded flex items-center justify-center border border-outline-variant">
                    <span className="label-caps text-muted-foreground">
                      {comp.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold">{comp.name}</h3>
                    <p className="text-[10px] label-caps text-muted-foreground">
                      {comp.domain}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "label-caps text-[9px] px-2 py-0.5 rounded",
                    i === 0
                      ? "bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {i === 0 ? "CRITICAL" : "MONITORING"}
                </span>
              </div>
              {i === 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-surface-container-lowest p-2 rounded">
                    <p className="text-[8px] label-caps text-muted-foreground">
                      OVERLAP
                    </p>
                    <p className="font-mono text-[13px] font-bold">
                      {comp.productsTracked} SKUs
                    </p>
                  </div>
                  <div className="bg-surface-container-lowest p-2 rounded">
                    <p className="text-[8px] label-caps text-muted-foreground">
                      PRICE INDEX
                    </p>
                    <p className="font-mono text-[13px] font-bold text-[#21a732]">
                      {Number(comp.priceIndex).toFixed(1)}
                    </p>
                  </div>
                  <div className="bg-surface-container-lowest p-2 rounded">
                    <p className="text-[8px] label-caps text-muted-foreground">
                      AVG DELTA
                    </p>
                    <p
                      className={cn(
                        "font-mono text-[13px] font-bold",
                        Number(comp.avgPriceDiff) < 0
                          ? "text-[#ffb4ab]"
                          : "text-primary"
                      )}
                    >
                      {Number(comp.avgPriceDiff).toFixed(1)}%
                    </p>
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center text-[11px] text-muted-foreground pt-3 border-t border-outline-variant/30">
                <span>Products: {comp.productsTracked}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    className="text-primary label-caps hover:underline flex items-center gap-1"
                    onClick={() =>
                      setFeedCompetitor({ id: comp.id, name: comp.name })
                    }
                  >
                    VIEW FEED <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    className="text-primary/70 hover:text-primary transition-colors p-1"
                    onClick={() =>
                      setAddProductTarget({
                        id: comp.id,
                        name: comp.name,
                        domain: comp.domain,
                      })
                    }
                    title="Add product"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="text-[#ffb4ab]/60 hover:text-[#ffb4ab] transition-colors p-1"
                    onClick={() =>
                      setDeleteTarget({ id: comp.id, name: comp.name })
                    }
                    title="Delete competitor"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-4 glass-card p-8 text-center text-muted-foreground">
            <Globe className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No competitors yet</p>
            <p className="text-xs">Add a competitor or import a CSV</p>
          </div>
        )}
      </div>

      {/* Feed Panel */}
      {feedCompetitor && (
        <CompetitorFeed
          competitorId={feedCompetitor.id}
          competitorName={feedCompetitor.name}
          onClose={() => setFeedCompetitor(null)}
        />
      )}

      {/* Comparison Table */}
      {allCompetitors.length > 0 && (
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex justify-between items-center">
            <h3 className="text-[15px] font-semibold">
              Competitor Price Comparison
            </h3>
            <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-highest rounded-full border border-outline-variant">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="label-caps text-[10px] text-muted-foreground">
                Live
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface-container/30 border-b border-white/[0.04] label-caps text-muted-foreground">
                  <TableHead className="px-5 py-3 font-normal">
                    Competitor
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal text-right">
                    Products
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal text-right">
                    Price Index
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal text-right">
                    Avg Diff
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal">
                    Status
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal text-right">
                    Last Scraped
                  </TableHead>
                  <TableHead className="px-5 py-3 font-normal text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-outline-variant/20">
                {allCompetitors.map(comp => {
                  const s = statusConfig[comp.status] ?? statusConfig.active;
                  return (
                    <TableRow
                      key={comp.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <TableCell className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-xs font-bold text-muted-foreground">
                            {comp.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[13px] font-medium">
                              {comp.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {comp.domain}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3 font-mono text-[13px] font-medium text-right">
                        {comp.productsTracked.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <span
                          className={cn(
                            "font-mono text-[13px] font-medium",
                            Number(comp.priceIndex) < 95
                              ? "text-primary"
                              : Number(comp.priceIndex) > 105
                                ? "text-[#ffb4ab]"
                                : ""
                          )}
                        >
                          {Number(comp.priceIndex).toFixed(1)}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-mono text-[13px] font-medium",
                            Number(comp.avgPriceDiff) < 0
                              ? "text-primary"
                              : "text-[#ffb4ab]"
                          )}
                        >
                          {Number(comp.avgPriceDiff) < 0 ? (
                            <TrendingDown className="h-3 w-3" />
                          ) : (
                            <TrendingUp className="h-3 w-3" />
                          )}
                          {Number(comp.avgPriceDiff) > 0 ? "+" : ""}
                          {Number(comp.avgPriceDiff).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps",
                            s.className
                          )}
                        >
                          {s.label}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-[11px] text-muted-foreground text-right">
                        {comp.lastScrapedAt
                          ? new Date(comp.lastScrapedAt).toLocaleString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )
                          : "Never"}
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-primary hover:text-primary/80"
                            onClick={() =>
                              setAddProductTarget({
                                id: comp.id,
                                name: comp.name,
                                domain: comp.domain,
                              })
                            }
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-primary hover:text-primary/80"
                            onClick={() =>
                              setFeedCompetitor({
                                id: comp.id,
                                name: comp.name,
                              })
                            }
                          >
                            <Activity className="h-3 w-3 mr-1" />
                            Feed
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-[#ffb4ab]/60 hover:text-[#ffb4ab] hover:bg-[#93000a]/10"
                            onClick={() =>
                              setDeleteTarget({ id: comp.id, name: comp.name })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          variant="outline"
          size="sm"
          className="border-outline-variant"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import CSV
        </Button>
        <Dialog
          open={dialogOpen}
          onOpenChange={o => {
            setDialogOpen(o);
            if (!o) form.reset();
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:brightness-110"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Competitor
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Add Competitor</DialogTitle>
              <DialogDescription>Track a new competitor.</DialogDescription>
            </DialogHeader>
            <form id="add-comp" onSubmit={handleAddCompetitor}>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cname">Name *</Label>
                  <Input id="cname" {...form.register("name")} />
                  {form.formState.errors.name && (
                    <p className="text-xs text-[#ffb4ab]">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cdomain">Domain *</Label>
                  <Input id="cdomain" {...form.register("domain")} />
                  {form.formState.errors.domain && (
                    <p className="text-xs text-[#ffb4ab]">
                      {form.formState.errors.domain.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cdesc">Description</Label>
                  <Textarea
                    id="cdesc"
                    className="min-h-[56px] resize-none"
                    {...form.register("description")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="add-comp"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Import Dialog */}
      <Dialog
        open={!!importPreview}
        onOpenChange={o => {
          if (!o) {
            setImportPreview(null);
            setImportResult(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Import Competitors</DialogTitle>
            <DialogDescription>
              {importResult
                ? "Complete!"
                : `${importPreview?.filter(r => r.valid).length ?? 0} valid rows`}
            </DialogDescription>
          </DialogHeader>
          {importResult ? (
            <div className="py-4">
              <div className="flex items-center gap-3 rounded border border-primary/20 bg-primary/5 p-4">
                <CheckCircle2 className="h-8 w-8 text-primary shrink-0" />
                <div>
                  <p className="font-medium text-primary">
                    Imported {importResult.imported}
                  </p>
                  {importResult.skipped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {importResult.skipped} skipped
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            importPreview && (
              <>
                <div className="max-h-[300px] overflow-auto rounded border border-outline-variant">
                  <Table>
                    <TableHeader>
                      <TableRow className="label-caps text-muted-foreground">
                        <TableHead className="w-10 text-center">#</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead className="w-16 text-center">
                          Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-outline-variant/20">
                      {importPreview.map((row, i) => (
                        <tr key={i} className={cn(!row.valid && "opacity-50")}>
                          <td className="text-center text-xs text-muted-foreground">
                            {row.rowNumber}
                          </td>
                          <td className="text-sm font-medium">
                            {row.name || "—"}
                          </td>
                          <td className="text-sm text-muted-foreground">
                            {row.domain || "—"}
                          </td>
                          <td className="text-center">
                            {row.valid ? (
                              <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-[#21a732] mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportPreview(null);
                      setImportResult(null);
                    }}
                    disabled={importing}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmImport}
                    disabled={
                      importing || !importPreview.filter(r => r.valid).length
                    }
                  >
                    {importing ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      `Import ${importPreview.filter(r => r.valid).length}`
                    )}
                  </Button>
                </DialogFooter>
              </>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={o => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Competitor</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.name}</strong>? This will permanently
              remove the competitor and all its matched product data. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })
              }
              disabled={deleteMutation.isPending}
              className="bg-[#93000a] text-[#ffb4ab] hover:bg-[#93000a]/80"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Product Dialog */}
      {addProductTarget && (
        <AddProductDialog
          competitorId={addProductTarget.id}
          competitorName={addProductTarget.name}
          competitorDomain={addProductTarget.domain}
          open={!!addProductTarget}
          onOpenChange={o => {
            if (!o) setAddProductTarget(null);
          }}
        />
      )}
    </div>
  );
}
