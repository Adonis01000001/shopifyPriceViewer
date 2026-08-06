import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { RouterOutputs } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Radar,
  Plus,
  Search,
  Check,
  Pencil,
  Link2,
  Trash2,
  Play,
  Square,
  Globe,
  Loader2,
  AlertCircle,
  Clock,
  Package,
  Activity,
  Gauge,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

type CatalogProduct = RouterOutputs["products"]["list"][number];
type Competitor = RouterOutputs["competitors"]["list"][number];
type CompetitorMapping =
  RouterOutputs["products"]["getCompetitorMappings"][number];

const statusBadge: Record<string, { label: string; className: string }> = {
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

const jobStatusBadge: Record<string, { label: string; className: string }> = {
  queued: {
    label: "QUEUED",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  running: {
    label: "RUNNING",
    className: "bg-[#63e063]/10 text-[#21a732] border-[#63e063]/20",
  },
  completed: {
    label: "COMPLETED",
    className: "bg-[#21a732]/10 text-[#21a732] border-[#21a732]/20",
  },
  failed: {
    label: "FAILED",
    className: "bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30",
  },
  cancelled: {
    label: "CANCELLED",
    className: "bg-muted text-muted-foreground border border-outline-variant",
  },
};

const createSourceSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  url: z.string().url("Must be a valid URL").max(2048),
  crawlDelayMs: z.number().int().min(0).max(60000).optional(),
});

type CreateSourceForm = z.infer<typeof createSourceSchema>;

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceRow({
  source,
  onStartCrawl,
  onCancelCrawl,
  onDelete,
  crawling,
}: {
  source: any;
  onStartCrawl: () => void;
  onCancelCrawl: (jobId: string) => void;
  onDelete: () => void;
  crawling: boolean;
}) {
  const [showJobs, setShowJobs] = useState(false);
  const { data: jobs } = trpc.priceRadar.history.useQuery(
    { sourceId: source.id, limit: 20 },
    { enabled: showJobs, refetchInterval: showJobs ? 3_000 : false }
  );
  const sourceJobs = jobs ?? [];

  const sb = statusBadge[source.status] ?? statusBadge.active;
  const hasRunning = sourceJobs.some(
    (j: any) => j.status === "running" || j.status === "queued"
  );

  useEffect(() => {
    if (hasRunning) setShowJobs(true);
  }, [hasRunning]);

  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[15px] font-semibold truncate">
                {source.name}
              </h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold label-caps border shrink-0",
                  sb.className
                )}
              >
                {sb.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {source.domain}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last crawled: {formatDate(source.lastCrawledAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-outline-variant text-[11px]"
              onClick={onStartCrawl}
              disabled={crawling || hasRunning}
            >
              {crawling ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-3 w-3" />
                  Crawl
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {sourceJobs.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setShowJobs(!showJobs)}
              >
                {showJobs ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showJobs && sourceJobs.length > 0 && (
        <div className="divide-y divide-outline-variant/20">
          {sourceJobs.map((job: any) => {
            const isRunning =
              job.status === "running" || job.status === "queued";
            const jb = jobStatusBadge[job.status] ?? {
              label: job.status.toUpperCase(),
              className:
                "bg-muted text-muted-foreground border-outline-variant",
            };
            return (
              <div
                key={job.id}
                className="px-5 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors"
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-bold label-caps border shrink-0",
                    jb.className
                  )}
                >
                  {jb.label}
                </span>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-1">
                  <span className="flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    {job.pagesVisited}/{job.pagesQueued} pages
                  </span>
                  <span className="flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    {job.productsExtracted} products
                  </span>
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3 w-3" />
                    {job.pagesSucceeded} ok / {job.pagesFailed} err
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onCancelCrawl(job.id)}
                    >
                      <Square className="mr-1 h-3 w-3" />
                      Stop
                    </Button>
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDate(job.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const competitorMappingSchema = z.object({
  competitorId: z.string().uuid("Choose a competitor"),
  title: z
    .string()
    .trim()
    .min(1, "Competitor product title is required")
    .max(500),
  url: z.union([z.literal(""), z.string().url("Enter a valid product URL")]),
  sku: z.string().trim().max(128),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid price"),
  currency: z.string().trim().length(3, "Use a 3-letter currency code"),
});

type CompetitorMappingForm = z.infer<typeof competitorMappingSchema>;

function CompetitorMappingDialog({
  product,
  competitors,
  mapping,
  open,
  onOpenChange,
}: {
  product: CatalogProduct;
  competitors: Competitor[];
  mapping: CompetitorMapping | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const form = useForm<CompetitorMappingForm>({
    resolver: zodResolver(competitorMappingSchema),
    defaultValues: {
      competitorId: mapping?.competitorId ?? "",
      title: mapping?.title ?? "",
      url: mapping?.url ?? "",
      sku: mapping?.sku ?? "",
      price: mapping?.price ?? "",
      currency: mapping?.currency ?? product.currency ?? "USD",
    },
  });

  useEffect(() => {
    form.reset({
      competitorId: mapping?.competitorId ?? "",
      title: mapping?.title ?? "",
      url: mapping?.url ?? "",
      sku: mapping?.sku ?? "",
      price: mapping?.price ?? "",
      currency: mapping?.currency ?? product.currency ?? "USD",
    });
  }, [form, mapping, product.currency]);

  const refreshMappings = useCallback(() => {
    void utils.products.getCompetitorMappings.invalidate();
    void utils.competitors.list.invalidate();
  }, [utils]);

  const addMapping = trpc.competitors.addProduct.useMutation({
    onSuccess: () => {
      refreshMappings();
      onOpenChange(false);
      toast.success("Competitor product linked");
    },
    onError: error => toast.error(error.message || "Failed to link product"),
  });

  const updateMapping = trpc.competitors.updateProduct.useMutation({
    onSuccess: () => {
      refreshMappings();
      onOpenChange(false);
      toast.success("Competitor product updated");
    },
    onError: error => toast.error(error.message || "Failed to update link"),
  });

  const submit = (data: CompetitorMappingForm) => {
    const values = {
      competitorId: data.competitorId,
      competitorProductTitle: data.title.trim(),
      competitorProductUrl: data.url.trim() || undefined,
      competitorSku: data.sku.trim() || undefined,
      price: data.price,
      currency: data.currency.trim().toUpperCase(),
    };

    if (mapping) {
      updateMapping.mutate({
        competitorProductId: mapping.id,
        ...values,
      });
      return;
    }

    addMapping.mutate({
      productId: product.id,
      matchScore: 1,
      matchMethod: "manual",
      ...values,
    });
  };

  const isPending = addMapping.isPending || updateMapping.isPending;
  const selectedCompetitor = form.watch("competitorId");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(submit)}>
          <DialogHeader>
            <DialogTitle>
              {mapping ? "Edit competitor product" : "Add competitor product"}
            </DialogTitle>
            <DialogDescription>
              Link a competitor listing to {product.title}. This keeps the
              competitor data attached to your existing product.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`competitor-${product.id}`}>Competitor</Label>
              <Select
                value={selectedCompetitor}
                onValueChange={value =>
                  form.setValue("competitorId", value, { shouldValidate: true })
                }
              >
                <SelectTrigger id={`competitor-${product.id}`}>
                  <SelectValue placeholder="Select a competitor" />
                </SelectTrigger>
                <SelectContent>
                  {competitors.map(competitor => (
                    <SelectItem key={competitor.id} value={competitor.id}>
                      {competitor.name} · {competitor.domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.competitorId && (
                <p className="text-[11px] text-destructive">
                  {form.formState.errors.competitorId.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`competitor-title-${product.id}`}>
                Product title
              </Label>
              <Input
                id={`competitor-title-${product.id}`}
                {...form.register("title")}
                placeholder="Competitor listing title"
              />
              {form.formState.errors.title && (
                <p className="text-[11px] text-destructive">
                  {form.formState.errors.title.message}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`competitor-price-${product.id}`}>Price</Label>
                <Input
                  id={`competitor-price-${product.id}`}
                  {...form.register("price")}
                  inputMode="decimal"
                  placeholder="99.99"
                />
                {form.formState.errors.price && (
                  <p className="text-[11px] text-destructive">
                    {form.formState.errors.price.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`competitor-currency-${product.id}`}>
                  Currency
                </Label>
                <Input
                  id={`competitor-currency-${product.id}`}
                  {...form.register("currency")}
                  maxLength={3}
                  placeholder="USD"
                />
                {form.formState.errors.currency && (
                  <p className="text-[11px] text-destructive">
                    {form.formState.errors.currency.message}
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`competitor-sku-${product.id}`}>SKU</Label>
                <Input
                  id={`competitor-sku-${product.id}`}
                  {...form.register("sku")}
                  placeholder="Optional SKU"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`competitor-url-${product.id}`}>
                  Product URL
                </Label>
                <Input
                  id={`competitor-url-${product.id}`}
                  {...form.register("url")}
                  placeholder="https://competitor.com/product"
                />
                {form.formState.errors.url && (
                  <p className="text-[11px] text-destructive">
                    {form.formState.errors.url.message}
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || competitors.length === 0}
            >
              {isPending
                ? "Saving..."
                : mapping
                  ? "Save changes"
                  : "Add competitor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductRadarCard({
  product,
  mappings,
  competitors,
  onToggleTracking,
  trackingPending,
}: {
  product: CatalogProduct;
  mappings: CompetitorMapping[];
  competitors: Competitor[];
  onToggleTracking: () => void;
  trackingPending: boolean;
}) {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] =
    useState<CompetitorMapping | null>(null);
  const removeMapping = trpc.competitors.removeProduct.useMutation({
    onSuccess: () => {
      void utils.products.getCompetitorMappings.invalidate();
      void utils.competitors.list.invalidate();
      toast.success("Competitor product removed");
    },
    onError: error => toast.error(error.message || "Failed to remove link"),
  });
  const dismissMapping = trpc.products.dismissCompetitorMapping.useMutation({
    onSuccess: () => {
      void utils.products.getCompetitorMappings.invalidate();
      toast.success("Automatic competitor match hidden");
    },
    onError: error => toast.error(error.message || "Failed to hide match"),
  });

  const openAddDialog = () => {
    setEditingMapping(null);
    setDialogOpen(true);
  };

  const openEditDialog = (mapping: CompetitorMapping) => {
    setEditingMapping(mapping);
    setDialogOpen(true);
  };

  return (
    <article className="glass-panel rounded-lg p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt=""
              className="h-12 w-12 rounded object-cover border border-outline-variant shrink-0"
            />
          ) : (
            <div
              className="h-12 w-12 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0"
              aria-hidden="true"
            >
              {product.title.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold truncate">
              {product.title}
            </h3>
            <p className="text-[11px] text-muted-foreground truncate">
              {product.sku ? `SKU: ${product.sku} · ` : ""}
              {product.currency || "USD"} {product.price}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={product.isTracked ? "default" : "outline"}
          aria-pressed={product.isTracked}
          disabled={trackingPending}
          onClick={onToggleTracking}
          className="shrink-0"
        >
          {product.isTracked ? "Monitoring" : "Start monitoring"}
        </Button>
      </div>

      <div className="mt-5 border-t border-outline-variant/20 pt-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h4 className="text-[12px] font-semibold label-caps text-muted-foreground">
            Competitor Products ({mappings.length})
          </h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-[11px]"
            onClick={openAddDialog}
            disabled={competitors.length === 0}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Competitor
          </Button>
        </div>

        {mappings.length > 0 ? (
          <div className="space-y-2">
            {mappings.map(mapping => (
              <div
                key={mapping.id}
                className="rounded-lg bg-surface-container-lowest border border-outline-variant/20 p-3 flex items-center gap-3"
              >
                <Link2
                  className="h-4 w-4 text-primary/70 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  {mapping.isAutomatic && (
                    <span className="mb-1 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                      AUTO-MATCHED
                    </span>
                  )}
                  <p className="text-[12px] font-medium truncate">
                    {mapping.competitorName}
                    {mapping.title ? ` · ${mapping.title}` : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {mapping.sku ? `SKU: ${mapping.sku} · ` : ""}
                    {mapping.currency || "USD"} {mapping.price}
                    {mapping.competitorDomain
                      ? ` · ${mapping.competitorDomain}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {mapping.url && (
                    <a
                      href={mapping.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline px-2"
                    >
                      View
                    </a>
                  )}
                  {!mapping.isAutomatic && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label={`Edit ${mapping.title || "competitor product"}`}
                      onClick={() => openEditDialog(mapping)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    aria-label={`${mapping.isAutomatic ? "Hide" : "Remove"} ${mapping.title || "competitor product"}`}
                    disabled={
                      removeMapping.isPending || dismissMapping.isPending
                    }
                    onClick={() => {
                      const shouldRemove = window.confirm(
                        mapping.isAutomatic
                          ? "Hide this automatic match?"
                          : "Remove this competitor product link?"
                      );
                      if (!shouldRemove) return;

                      const sourceProductId = mapping.sourceProductId;
                      const competitorId = mapping.competitorId;
                      if (
                        mapping.isAutomatic &&
                        competitorId &&
                        sourceProductId &&
                        (mapping.source === "price-radar" ||
                          mapping.source === "scoop")
                      ) {
                        dismissMapping.mutate({
                          productId: mapping.productId,
                          competitorId,
                          sourceType: mapping.source,
                          sourceProductId,
                        });
                      } else {
                        removeMapping.mutate({
                          competitorProductId: mapping.id,
                        });
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-outline-variant p-5 text-center text-muted-foreground">
            <Link2
              className="h-6 w-6 mx-auto mb-2 opacity-40"
              aria-hidden="true"
            />
            <p className="text-[12px] font-medium">
              No competitor products linked
            </p>
            <p className="text-[11px] mt-1">
              Matching competitor names are linked automatically. Add a listing
              manually when you need a different match.
            </p>
          </div>
        )}
      </div>

      <CompetitorMappingDialog
        product={product}
        competitors={competitors}
        mapping={editingMapping}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </article>
  );
}

export default function PriceRadar() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [crawlingSources, setCrawlingSources] = useState<Set<string>>(
    new Set()
  );

  const { data: info } = trpc.priceRadar.info.useQuery();
  const {
    data: sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
  } = trpc.priceRadar.sources.useQuery();
  const [catalogQuery, setCatalogQuery] = useState("");
  const {
    data: catalogProducts,
    isLoading: catalogLoading,
    error: catalogError,
    refetch: refetchCatalog,
  } = trpc.products.list.useQuery(undefined, { staleTime: 1000 * 60 * 5 });
  const {
    data: catalogMatches,
    isFetching: catalogSearchLoading,
    error: catalogSearchError,
    refetch: refetchCatalogSearch,
  } = trpc.products.search.useQuery(
    { query: catalogQuery.trim() },
    {
      enabled: catalogQuery.trim().length > 0,
      staleTime: 1000 * 60,
    }
  );
  const {
    data: availableCompetitors,
    isLoading: competitorsLoading,
    error: competitorsError,
  } = trpc.competitors.list.useQuery(undefined, { staleTime: 1000 * 60 * 5 });
  const {
    data: competitorMappings,
    isLoading: mappingsLoading,
    error: mappingsError,
    refetch: refetchMappings,
  } = trpc.products.getCompetitorMappings.useQuery(undefined, {
    staleTime: 1000 * 60,
    refetchOnMount: "always",
  });
  const { data: jobs } = trpc.priceRadar.history.useQuery({ limit: 100 });

  const createSource = trpc.priceRadar.createSource.useMutation({
    onSuccess: () => {
      toast.success("Source created");
      setCreateOpen(false);
      form.reset();
      refetchSources();
    },
    onError: err => {
      toast.error(err.message || "Failed to create source");
    },
  });

  const deleteSource = trpc.priceRadar.deleteSource.useMutation({
    onSuccess: () => {
      toast.success("Source deleted");
      setDeleteId(null);
      refetchSources();
    },
    onError: err => {
      toast.error(err.message || "Failed to delete source");
    },
  });

  const startCrawl = trpc.priceRadar.startCrawl.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Crawl started — ${data.pagesQueued} pages queued`);
      refetchSources();
    },
    onError: err => {
      toast.error(err.message || "Failed to start crawl");
    },
  });

  const cancelCrawl = trpc.priceRadar.cancelCrawl.useMutation({
    onSuccess: () => {
      toast.success("Crawl cancelled");
      refetchSources();
    },
    onError: err => {
      toast.error(err.message || "Failed to cancel crawl");
    },
  });

  const toggleProductTracking = trpc.products.toggleTracking.useMutation({
    onSuccess: product => {
      toast.success(
        product.isTracked
          ? `${product.title} added to Price Radar`
          : `${product.title} removed from Price Radar`
      );
      void refetchCatalog();
      if (catalogQuery.trim()) void refetchCatalogSearch();
    },
    onError: error => {
      toast.error(error.message || "Failed to update product monitoring");
    },
  });

  const form = useForm<CreateSourceForm>({
    resolver: zodResolver(createSourceSchema),
    defaultValues: { name: "", url: "", crawlDelayMs: 300 },
  });

  const handleCreateSource = useCallback(
    (data: CreateSourceForm) => {
      createSource.mutate(data);
    },
    [createSource]
  );

  const handleStartCrawl = useCallback(
    async (sourceId: string) => {
      setCrawlingSources(prev => new Set(prev).add(sourceId));
      try {
        await startCrawl.mutateAsync({ sourceId });
      } finally {
        setCrawlingSources(prev => {
          const n = new Set(prev);
          n.delete(sourceId);
          return n;
        });
      }
    },
    [startCrawl]
  );

  const sourceList = sources ?? [];
  const productList = catalogProducts ?? [];
  const competitorList = availableCompetitors ?? [];
  const trackedProducts = productList.filter(product => product.isTracked);
  const catalogResults = catalogQuery.trim()
    ? (catalogMatches ?? [])
    : productList;
  const mappingsByProduct = useMemo(() => {
    const grouped = new Map<string, CompetitorMapping[]>();
    for (const mapping of competitorMappings ?? []) {
      const productMappings = grouped.get(mapping.productId) ?? [];
      productMappings.push(mapping);
      grouped.set(mapping.productId, productMappings);
    }
    return grouped;
  }, [competitorMappings]);
  const automaticMappingCount = (competitorMappings ?? []).filter(
    mapping => mapping.isAutomatic
  ).length;
  const jobsList = jobs ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <p className="page-kicker">Competitive monitoring</p>
          <h2 className="page-title flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" />
            Price Radar
          </h2>
          <p className="page-description">
            Connect competitor listings to your catalog and keep the price
            changes that matter in view.
          </p>
        </div>
        <div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:brightness-110"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={form.handleSubmit(handleCreateSource)}>
                <DialogHeader>
                  <DialogTitle>Add Crawl Source</DialogTitle>
                  <DialogDescription>
                    Enter the URL of a competitor website to start crawling for
                    product prices.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      placeholder="Amazon Electronics"
                      {...form.register("name")}
                    />
                    {form.formState.errors.name && (
                      <p className="text-[11px] text-destructive">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="url">Base URL</Label>
                    <Input
                      id="url"
                      placeholder="https://amazon.com/electronics"
                      {...form.register("url")}
                    />
                    {form.formState.errors.url && (
                      <p className="text-[11px] text-destructive">
                        {form.formState.errors.url.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="crawlDelayMs">Crawl delay (ms)</Label>
                    <Input
                      id="crawlDelayMs"
                      type="number"
                      placeholder="300"
                      {...form.register("crawlDelayMs", {
                        valueAsNumber: true,
                      })}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Min interval between requests. Higher = more polite but
                      slower.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createSource.isPending}>
                    {createSource.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Create Source"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold font-mono tracking-tight">
              {sourceList.length}
            </p>
            <p className="label-caps text-muted-foreground/60">Sources</p>
          </div>
          <Radar className="h-8 w-8 text-primary/30" />
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold font-mono tracking-tight">
              {jobsList.length}
            </p>
            <p className="label-caps text-muted-foreground/60">Crawl Jobs</p>
          </div>
          <Activity className="h-8 w-8 text-primary/30" />
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold font-mono tracking-tight">
              {trackedProducts.length}
            </p>
            <p className="label-caps text-muted-foreground/60">
              Monitored Products
            </p>
          </div>
          <Check className="h-8 w-8 text-primary/30" />
        </div>
      </div>

      {/* Product catalog and competitor mappings */}
      <section aria-labelledby="radar-mappings-title">
        <div className="flex flex-col gap-1 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id="radar-mappings-title"
              className="text-lg font-bold text-primary"
            >
              Product monitoring
            </h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {automaticMappingCount} automatic{" "}
              {automaticMappingCount === 1 ? "match" : "matches"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Every product below comes from your Products catalog. Exact matching
            competitor names are linked automatically; you can hide incorrect
            matches or add a different listing manually.
          </p>
        </div>
        <div className="relative max-w-md mb-4">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="search-radar-products"
            value={catalogQuery}
            onChange={event => setCatalogQuery(event.target.value)}
            placeholder="Search products or SKUs..."
            aria-label="Search products to monitor"
            className="pl-9 h-9 bg-surface-container border-outline-variant"
          />
        </div>
        {catalogError ||
        catalogSearchError ||
        mappingsError ||
        competitorsError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive">
              {catalogError?.message ||
                catalogSearchError?.message ||
                mappingsError?.message ||
                competitorsError?.message ||
                "Failed to load product mappings"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                void refetchCatalog();
                void refetchMappings();
                if (catalogQuery.trim()) void refetchCatalogSearch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : catalogLoading ||
          catalogSearchLoading ||
          mappingsLoading ||
          competitorsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span className="ml-2 text-sm">Loading product mappings...</span>
          </div>
        ) : catalogResults.length > 0 ? (
          <div className="grid gap-4">
            {catalogResults.map(product => (
              <ProductRadarCard
                key={product.id}
                product={product}
                mappings={mappingsByProduct.get(product.id) ?? []}
                competitors={competitorList}
                trackingPending={toggleProductTracking.isPending}
                onToggleTracking={() =>
                  toggleProductTracking.mutate({
                    id: product.id,
                    isTracked: !product.isTracked,
                  })
                }
              />
            ))}
          </div>
        ) : (
          <div className="glass-panel rounded-lg p-12 text-center text-muted-foreground">
            <Package
              className="h-10 w-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              {catalogQuery.trim()
                ? "No matching products"
                : "No products in your catalog"}
            </p>
            <p className="text-xs mt-1">
              {catalogQuery.trim()
                ? "Try a different product name or SKU."
                : "Add products from the Products page to configure monitoring."}
            </p>
          </div>
        )}
        {!competitorsLoading &&
          competitorList.length === 0 &&
          productList.length > 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-outline-variant p-4 text-center text-muted-foreground">
              <p className="text-sm font-medium">Add a competitor first</p>
              <p className="text-xs mt-1">
                Create a competitor in the Competitors page before linking
                listings.
              </p>
            </div>
          )}
      </section>
      {/*

                    {product.sku || product.category || "No SKU"} ·{" "}

      */}
      {/* Sources list */}
      {sourcesLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <span className="ml-3 text-muted-foreground">Loading sources...</span>
        </div>
      )}

      {!sourcesLoading && sourceList.length > 0 && (
        <div className="space-y-3">
          {sourceList.map((source: any) => (
            <SourceRow
              key={source.id}
              source={source}
              onStartCrawl={() => handleStartCrawl(source.id)}
              onCancelCrawl={jobId => cancelCrawl.mutate({ jobId })}
              onDelete={() => setDeleteId(source.id)}
              crawling={crawlingSources.has(source.id)}
            />
          ))}
        </div>
      )}

      {!sourcesLoading && sourceList.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground">
          <Radar className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No sources yet</p>
          <p className="text-xs mt-1">
            Add a competitor URL to start crawling for prices.
          </p>
        </div>
      )}

      {/* Info card */}
      <div className="glass-panel rounded-lg p-4 border border-outline-variant/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-[12px]">
              How Price Radar works
            </p>
            <p>
              • <strong>Sources</strong> are competitor website URLs you want to
              crawl for product data
            </p>
            <p>
              • Each <strong>Crawl</strong> navigates the source domain,
              discovers product pages, and extracts pricing data
            </p>
            <p>
              • Crawls respect <strong>robots.txt</strong> and use configurable
              rate limits
            </p>
            <p>
              • Found products are stored with their prices, availability, SKU,
              and metadata
            </p>
            <p>
              • Use the <strong>Products</strong> tab to review discovered items
              and link them to your catalog
            </p>
            {info && (
              <p className="text-[10px] text-muted-foreground/60 pt-1">
                Engine: {info.name} — Default policy: {info.defaults.maxPages}{" "}
                max pages, {info.defaults.concurrency} concurrent,{" "}
                {info.defaults.maxDepth} max depth
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={o => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the source and remove it from your list.
              Existing crawl data will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteId && deleteSource.mutate({ sourceId: deleteId })
              }
              className="bg-destructive text-destructive-foreground hover:brightness-110"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
