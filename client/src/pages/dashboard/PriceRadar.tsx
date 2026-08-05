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
import {
  Radar,
  Plus,
  Trash2,
  Play,
  Square,
  Globe,
  Loader2,
  ExternalLink,
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

function formatPrice(
  value: string | number,
  currency: string | null | undefined
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(value));
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
  const { data: products } = trpc.priceRadar.products.useQuery({ limit: 50 });
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
  const productsList = useMemo(
    () =>
      (products ?? []).filter(
        (product: any) =>
          typeof product.name === "string" &&
          product.name.trim().length > 0 &&
          product.price != null
      ),
    [products]
  );
  const jobsList = jobs ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
              <Radar className="h-6 w-6" />
              Price Radar
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Crawl competitor websites to discover and track their product
              prices automatically.
            </p>
          </div>
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
              {productsList.length}
            </p>
            <p className="label-caps text-muted-foreground/60">
              Products Found
            </p>
          </div>
          <Package className="h-8 w-8 text-primary/30" />
        </div>
      </div>

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

      {/* Products found */}
      {productsList.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-primary flex items-center gap-2 mb-3">
            <Package className="h-5 w-5" />
            Discovered Products
          </h3>
          <div className="grid gap-2">
            {productsList.map((p: any) => (
              <div
                key={p.id}
                className="glass-panel rounded-lg px-5 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  {p.productUrl ? (
                    <a
                      href={p.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-medium truncate block hover:text-primary"
                    >
                      {p.name}
                    </a>
                  ) : (
                    <p className="text-[13px] font-medium truncate">{p.name}</p>
                  )}
                </div>
                <span className="font-mono text-[15px] font-bold shrink-0">
                  {formatPrice(p.price, p.currency)}
                </span>
                {p.productUrl && (
                  <ExternalLink
                    className="h-4 w-4 text-primary shrink-0"
                    aria-hidden="true"
                  />
                )}
              </div>
            ))}
          </div>
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
