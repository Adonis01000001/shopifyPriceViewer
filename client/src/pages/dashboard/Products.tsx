import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { trpc } from "@/lib/trpc";
import { Download, Search, Package, Database, ExternalLink, Zap, RotateCcw } from "lucide-react";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia, EmptyContent } from "@/components/ui/empty";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import AddProductDialog from "./AddProductDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import Papa from "papaparse";
import { toast } from "sonner";

// ─── Market Position Badge ───────────────────────────────────────────────────

type MarketPositionStatus =
  | "LEADING"
  | "COMPETITIVE"
  | "OVERPRICED"
  | "INSUFFICIENT_DATA";

const POSITION_STYLES: Record<
  MarketPositionStatus,
  { bg: string; text: string; border: string }
> = {
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

const POSITION_LABELS: Record<MarketPositionStatus, string> = {
  LEADING: "LEAD",
  COMPETITIVE: "COMP",
  OVERPRICED: "OVER",
  INSUFFICIENT_DATA: "N/A",
};

function MarketPositionBadge({ productId }: { productId: string }) {
  const { data, isLoading } = trpc.pricingEngine.getMarketPosition.useQuery(
    { productId },
    { enabled: !!productId }
  );

  if (isLoading) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps bg-surface-container-highest text-muted-foreground">
        ...
      </span>
    );
  }

  if (!data?.position) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps bg-gray-500/10 text-gray-400 border border-gray-500/30">
        N/A
      </span>
    );
  }

  const status = data.position.status as MarketPositionStatus;
  const style = POSITION_STYLES[status] ?? POSITION_STYLES.INSUFFICIENT_DATA;
  const label = POSITION_LABELS[status] ?? "N/A";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps border",
        style.bg,
        style.text,
        style.border
      )}
    >
      {label}
    </span>
  );
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
    className: "bg-[#93000a]/15 text-[#ffb4ab] border border-[#93000a]/30",
  },
  alert: {
    label: "Alert",
    className: "bg-[#93000a]/20 text-[#ffb4ab] border border-[#93000a]/30",
  },
};

export default function Products() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: allProducts, isLoading, refetch, error } = trpc.products.list.useQuery();
  const { data: stats, error: statsError } = trpc.products.stats.useQuery();

  const updateProductMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      toast.success("Price updated");
      refetch();
    },
    onError: () => {
      toast.error("Failed to update price");
    },
  });

  const products = allProducts ?? [];
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
      const mst = statusFilter === "all" || p.status === statusFilter;
      return ms && mc && mst;
    });
  }, [products, searchQuery, categoryFilter, statusFilter]);

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

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-primary">Product Inventory</h2>
          <p className="text-muted-foreground text-sm">Failed to load products. Please try again.</p>
        </div>
        <div className="glass-panel rounded-lg p-12 text-center">
          <p className="text-[#ffb4ab] text-sm mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton />;

  const statusCounts = {
    optimal: stats?.optimal ?? 0,
    underpriced: stats?.underpriced ?? 0,
    overpriced: stats?.overpriced ?? 0,
    alert: stats?.alert ?? 0,
  };

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-primary">
            Product Inventory
          </h2>
          <p className="text-muted-foreground text-sm">
            No products tracked yet. Start by connecting your Shopify store.
          </p>
        </div>
        <Empty>
          <EmptyMedia variant="icon"><Package className="h-6 w-6" /></EmptyMedia>
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
              className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-9 px-4 hover:bg-primary/90 transition-colors"
            >
              <Database className="h-4 w-4 mr-2" />
              Connect Shopify Store
            </a>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">
          Product Inventory
        </h2>
        <p className="text-muted-foreground text-sm">
          Manage {products.length} active listings across your Shopify
          storefront.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {(["optimal", "underpriced", "overpriced", "alert"] as const).map(
          status => {
            const count = statusCounts[status];
            const config = statusConfig[status];
            const total = products.length || 1;
            return (
              <div
                key={status}
                className="glass-card p-4 flex items-center justify-between hover:border-primary/20 transition-all"
              >
                <div>
                  <p className="text-2xl font-bold font-mono tracking-tight">
                    {count}
                  </p>
                  <p className="label-caps text-muted-foreground/60">
                    {config.label}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-bold",
                    config.className
                  )}
                >
                  {((count / total) * 100).toFixed(0)}%
                </span>
              </div>
            );
          }
        )}
      </div>

      {/* Filter Bar */}
      <div className="glass-panel p-4 rounded-lg flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="search-products"
            placeholder="Search products or SKUs..."
            className="pl-9 h-9 bg-surface-container border-outline-variant"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-[150px] bg-surface-container border-outline-variant">
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px] bg-surface-container border-outline-variant">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="optimal">Optimal</SelectItem>
            <SelectItem value="underpriced">Underpriced</SelectItem>
            <SelectItem value="overpriced">Overpriced</SelectItem>
            <SelectItem value="alert">Alert</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-outline-variant"
          onClick={handleExport}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <AddProductDialog onSuccess={() => refetch()} />
      </div>

      {/* Table */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-container-high border-b border-outline-variant/30">
                <TableHead className="pl-5 label-caps text-muted-foreground font-normal">
                  Product
                </TableHead>
                <TableHead className="label-caps text-muted-foreground font-normal">
                  SKU
                </TableHead>
                <TableHead className="text-right label-caps text-muted-foreground font-normal">
                  Price
                </TableHead>
                <TableHead className="text-right label-caps text-muted-foreground font-normal hidden sm:table-cell">
                  Market Low
                </TableHead>
                <TableHead className="text-center label-caps text-muted-foreground font-normal hidden sm:table-cell">
                  Delta
                </TableHead>
                <TableHead className="text-center label-caps text-muted-foreground font-normal">
                  Status
                </TableHead>
                <TableHead className="text-center label-caps text-muted-foreground font-normal">
                  Position
                </TableHead>
                <TableHead className="pr-5 label-caps text-muted-foreground font-normal text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-outline-variant/20">
              {filtered.length > 0 ? (
                filtered.map(product => {
                  const status =
                    statusConfig[product.status] ?? statusConfig.optimal;
                  return (
                    <TableRow
                      key={product.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <TableCell className="pl-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-surface-container-highest border border-outline-variant flex items-center justify-center text-xs font-bold text-muted-foreground">
                            {product.title.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[13px] font-medium">
                              {product.title}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {product.category || "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-[12px] text-muted-foreground text-center">
                        {product.sku || "—"}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-[13px] font-medium text-right">
                        ${Number(product.price).toFixed(2)}
                      </TableCell>
                      <TableCell className="py-3 font-mono text-[13px] text-muted-foreground text-right hidden sm:table-cell">
                        —
                      </TableCell>
                      <TableCell className="py-3 text-center hidden sm:table-cell">
                        <span className="font-mono text-[12px] text-muted-foreground">
                          —
                        </span>
                      </TableCell>
                      <TableCell className="py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps",
                            status.className
                          )}
                        >
                          {status.label.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 text-center">
                        <MarketPositionBadge productId={product.id} />
                      </TableCell>
                      <TableCell className="pr-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 text-muted-foreground">
                          <button
                            className="hover:text-primary transition-colors text-sm"
                            title="Scout prices"
                            onClick={() => navigate(`/price-scout?productId=${product.id}`)}
                          >
                            <Zap className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="hover:text-primary transition-colors text-sm"
                            title="View details"
                            onClick={() => navigate(`/products/${product.id}`)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="hover:text-primary transition-colors text-sm p-1">
                                ⋮
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => navigate(`/price-scout?productId=${product.id}`)}
                              >
                                Scout Prices
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(product.id);
                                  toast.success("Product ID copied");
                                }}
                              >
                                Copy Product ID
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
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
                          setStatusFilter("all");
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
