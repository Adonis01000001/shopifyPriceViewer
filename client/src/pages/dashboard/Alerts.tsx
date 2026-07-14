import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia, EmptyContent } from "@/components/ui/empty";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Search,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  Zap,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";

const severityConfig: Record<string, { label: string; className: string }> = {
  critical: {
    label: "CRITICAL",
    className: "bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/30",
  },
  high: {
    label: "HIGH",
    className: "bg-[#93000a]/15 text-[#ffb4ab]/80 border-[#ffb4ab]/20",
  },
  medium: {
    label: "MEDIUM",
    className: "bg-[#63e063]/10 text-[#21a732] border-[#63e063]/20",
  },
  low: {
    label: "LOW",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
};

const typeConfig: Record<string, { label: string; icon: typeof TrendingDown }> =
  {
    price_drop: { label: "Price Drop", icon: TrendingDown },
    price_increase: { label: "Price Increase", icon: TrendingUp },
    competitor_change: { label: "Competitor Change", icon: ArrowUpDown },
    threshold: { label: "Threshold", icon: Zap },
  };

function AlertRow({
  alert,
  onResolve,
  isResolving,
}: {
  alert: any;
  onResolve: (id: string) => void;
  isResolving: boolean;
}) {
  const severity = severityConfig[alert.severity] ?? severityConfig.medium;
  const type = typeConfig[alert.alertType] ?? typeConfig.threshold;
  const TypeIcon = type.icon;
  const createdAt = (() => {
    try {
      return new Date(alert.createdAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  })();

  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-lg border p-4 transition-colors",
        alert.isResolved
          ? "opacity-50 border-outline-variant/30 bg-surface-container-low"
          : "border-outline-variant/30 bg-surface-container-low hover:bg-surface-container"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded",
          alert.isResolved ? "bg-muted" : severity.className
        )}
      >
        {alert.isResolved ? (
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        ) : (
          <TypeIcon className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-medium">{alert.title}</p>
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold label-caps",
              severity.className
            )}
          >
            {severity.label}
          </span>
          <span className="inline-flex items-center rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] label-caps text-muted-foreground">
            {type.label}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          {alert.message}
        </p>
        <p className="text-[10px] label-caps text-muted-foreground/60 mt-1.5">
          {createdAt}
        </p>
      </div>
      {!alert.isResolved && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-[11px] border-outline-variant"
          onClick={() => onResolve(alert.id)}
          disabled={isResolving}
        >
          Resolve
        </Button>
      )}
    </div>
  );
}

export default function Alerts() {
  const utils = trpc.useUtils();
  useRealtimeNotifications();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { data: alerts, isLoading, error } = trpc.alerts.list.useQuery({
    unreadOnly: false,
    limit: 100,
  });
  const { data: stats } = trpc.alerts.stats.useQuery();

  const resolveMutation = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      utils.alerts.stats.invalidate();
    },
    onError: () => toast.error("Failed to resolve alert"),
  });

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-primary">Alerts</h2>
          <p className="text-muted-foreground text-sm">Failed to load alerts.</p>
        </div>
        <div className="glass-panel rounded-lg p-12 text-center">
          <p className="text-[#ffb4ab] text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageSkeleton />;

  const allAlerts = alerts ?? [];
  const criticalCount = stats?.critical ?? 0;
  const activeCount = allAlerts.filter(a => !a.isResolved).length;
  const resolvedCount = stats?.resolved ?? 0;

  const filteredAlerts = allAlerts.filter(alert => {
    const matchesSearch =
      !searchQuery ||
      alert.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "active" && !alert.isResolved) ||
      (activeTab === "resolved" && alert.isResolved) ||
      activeTab === alert.severity;
    return matchesSearch && matchesTab;
  });

  if (allAlerts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-primary">Alerts</h2>
          <p className="text-muted-foreground text-sm">
            No alerts yet. Alerts will appear when price changes or threshold
            breaches are detected.
          </p>
        </div>
        <Empty>
          <EmptyMedia variant="icon"><ShieldCheck className="h-6 w-6" /></EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>All clear</EmptyTitle>
            <EmptyDescription>
              You'll receive alerts when competitor prices change, thresholds
              are breached, or significant market movements are detected.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-[10px] text-muted-foreground/60">
              Set price alert thresholds in the settings panel.
            </p>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Alerts</h2>
        <p className="text-muted-foreground text-sm">
          Monitor price changes, competitor movements, and threshold breaches.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-[#93000a]/15">
            <AlertTriangle className="h-5 w-5 text-[#ffb4ab]" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{criticalCount}</p>
            <p className="label-caps text-muted-foreground/60">Critical</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-[#63e063]/10">
            <Bell className="h-5 w-5 text-[#21a732]" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{activeCount}</p>
            <p className="label-caps text-muted-foreground/60">Active</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/[0.1]">
            <CheckCircle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{resolvedCount}</p>
            <p className="label-caps text-muted-foreground/60">Resolved</p>
          </div>
        </div>
      </div>

      {/* Filters & Tabs */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-[15px] font-semibold">All Alerts</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                name="search-alerts"
                placeholder="Search alerts..."
                className="pl-9 h-9 w-[200px] bg-surface-container border-outline-variant"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <Select defaultValue="newest">
              <SelectTrigger className="h-9 w-[130px] bg-surface-container border-outline-variant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-5">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-4"
          >
            <TabsList className="h-9 bg-surface-container border border-outline-variant">
              <TabsTrigger value="all" className="text-[11px] label-caps">
                All ({allAlerts.length})
              </TabsTrigger>
              <TabsTrigger value="active" className="text-[11px] label-caps">
                Active ({activeCount})
              </TabsTrigger>
              <TabsTrigger value="critical" className="text-[11px] label-caps">
                Critical ({criticalCount})
              </TabsTrigger>
              <TabsTrigger value="resolved" className="text-[11px] label-caps">
                Resolved ({resolvedCount})
              </TabsTrigger>
            </TabsList>
            <TabsContent value={activeTab} className="space-y-3 mt-4">
              {filteredAlerts.length > 0 ? (
                filteredAlerts.map(alert => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onResolve={id => resolveMutation.mutate({ id })}
                    isResolving={resolveMutation.isPending}
                  />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Bell className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No alerts found</p>
                  <p className="text-xs">Try adjusting filters</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
