import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Bot,
  RefreshCw,
  Search,
  Settings,
  CheckCircle,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const typeConfig: Record<
  string,
  { icon: typeof AlertTriangle; color: string; bg: string }
> = {
  alert: { icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10" },
  scrape: { icon: RefreshCw, color: "text-blue-500", bg: "bg-blue-500/10" },
  recommendation: {
    icon: Bot,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  discovery: { icon: Search, color: "text-amber-500", bg: "bg-amber-500/10" },
  update: {
    icon: Settings,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  resolve: {
    icon: CheckCircle,
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
};

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

export function RecentActivity() {
  const { data: activities } = trpc.activity.recent.useQuery({ limit: 10 });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {activities && activities.length > 0 ? (
          activities.map(
            (
              item: {
                entityType: string | null;
                action: string;
                detail: string | null;
                createdAt: string | Date;
              },
              index: number
            ) => {
              const entityType = item.entityType ?? "update";
              const config = typeConfig[entityType] ?? typeConfig.update;
              const Icon = config.icon;
              return (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      config.bg
                    )}
                  >
                    <Icon className={cn("h-4 w-4", config.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">
                      {item.action}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.detail}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[12px] font-normal"
                  >
                    {item.createdAt ? timeAgo(item.createdAt) : ""}
                  </Badge>
                </div>
              );
            }
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Activity className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs">No recent activity</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
