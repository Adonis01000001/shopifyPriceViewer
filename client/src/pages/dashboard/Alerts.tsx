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
import { useShopContext } from "@/contexts/ShopContext";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
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
    label: "Worth acting on",
    className:
      "bg-[var(--destructive)]/20 text-[var(--destructive)] border-[var(--destructive)]/30",
  },
  high: {
    label: "Worth a look",
    className:
      "bg-[var(--destructive)]/15 text-[var(--destructive)]/80 border-[var(--destructive)]/20",
  },
  medium: {
    label: "Small move",
    className:
      "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20",
  },
  low: {
    label: "Minor",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
};

const typeConfig: Record<string, { label: string; icon: typeof TrendingDown }> =
  {
    price_drop: { label: "A rival dropped their price", icon: TrendingDown },
    price_increase: { label: "A rival raised their price", icon: TrendingUp },
    competitor_change: { label: "A rival changed something", icon: ArrowUpDown },
    threshold: { label: "Past a limit you set", icon: Zap },
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
          <p className="text-[14px] font-medium">{alert.title}</p>
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-[12px] font-semibold",
              severity.className
            )}
          >
            {severity.label}
          </span>
          <span className="inline-flex min-h-6 items-center whitespace-nowrap rounded-full bg-surface-container px-2.5 py-0.5 text-[12px] text-muted-foreground">
            {type.label}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">
          {alert.message}
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{createdAt}</p>
      </div>
      {!alert.isResolved && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-[13px] border-outline-variant"
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
  const { selectedShopId } = useShopContext();
  useRealtimeNotifications();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const {
    data: alerts,
    isLoading,
    error,
  } = trpc.alerts.list.useQuery({
    unreadOnly: false,
    limit: 100,
    storeId: selectedShopId ?? undefined,
  });
  const { data: stats } = trpc.alerts.stats.useQuery(
    selectedShopId ? { storeId: selectedShopId } : undefined
  );

  const resolveMutation = trpc.alerts.markRead.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      utils.alerts.stats.invalidate();
    },
    onError: () => toast.error("Failed to resolve alert"),
  });

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Price changes"
          title="Price changes"
          description="Failed to load alerts."
          icon={AlertTriangle}
        />
        <div className="glass-card rounded-2xl p-8 text-center sm:p-12">
          <p className="text-[var(--destructive)] text-sm">{error.message}</p>
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
      <div className="space-y-8">
        <PageHeader
          eyebrow="Price changes"
          title="Price changes"
          description="When a shop we watch changes a price on something you sell, it turns up here."
          icon={ShieldCheck}
        />
        <Empty>
          <EmptyMedia variant="icon">
            <ShieldCheck className="h-6 w-6" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>All clear</EmptyTitle>
            <EmptyDescription>
              Nobody we watch has changed a price on anything you sell.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-[13px] text-muted-foreground">
              Nothing is needed from you. We check every day and this fills in
              when a rival moves a price on something you sell.
            </p>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Price changes"
        title="Price changes"
        description="We tell you here when a competitor moves a price on something you sell."
        icon={AlertTriangle}
      />

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-[var(--destructive)]/15">
            <AlertTriangle className="h-5 w-5 text-[var(--destructive)]" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{criticalCount}</p>
            <p className="text-[13px] text-muted-foreground">Worth acting on</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-[var(--success)]/10">
            <Bell className="h-5 w-5 text-[var(--success)]" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{activeCount}</p>
            <p className="text-[13px] text-muted-foreground">Still open</p>
          </div>
        </div>
        <div className="glass-card p-5 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/[0.1]">
            <CheckCircle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono">{resolvedCount}</p>
            <p className="text-[13px] text-muted-foreground">Dealt with</p>
          </div>
        </div>
      </div>

      {/* Filters & Tabs */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-4 bg-surface-container/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              <TabsTrigger value="all" className="text-[13px]">
                Everything ({allAlerts.length})
              </TabsTrigger>
              <TabsTrigger value="active" className="text-[13px]">
                Still open ({activeCount})
              </TabsTrigger>
              <TabsTrigger value="critical" className="text-[13px]">
                Worth acting on ({criticalCount})
              </TabsTrigger>
              <TabsTrigger value="resolved" className="text-[13px]">
                Dealt with ({resolvedCount})
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
import { PageHeader } from "@/components/workspace/PageHeader";
