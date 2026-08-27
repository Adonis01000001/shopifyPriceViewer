import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  description?: string;
  trend?: "up" | "down" | "neutral";
  variant?: "default" | "success" | "warning" | "danger";
}

const variantIconBg: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export function KPICard({
  title,
  value,
  change,
  icon,
  description,
  trend,
  variant = "default",
}: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const trendColor =
    trend === "up" || (trend === undefined && isPositive)
      ? "text-success"
      : trend === "down" || (trend === undefined && isNegative)
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card
      className={cn(
        "glass-card group relative overflow-hidden",
        "transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <p className="text-[13px] uppercase tracking-wider font-medium text-muted-foreground/70">
              {title}
            </p>
            <p className="text-2xl font-semibold data-value tracking-tight leading-none">
              {value}
            </p>
            {change !== undefined && (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  trendColor
                )}
              >
                {isPositive ? (
                  <TrendingUp className="h-3 w-3" />
                ) : isNegative ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                <span className="data-value">
                  {isPositive ? "+" : ""}
                  {change}%
                </span>
                <span className="text-muted-foreground font-normal">
                  vs last month
                </span>
              </div>
            )}
            {description && (
              <p className="text-[13px] text-muted-foreground/60 leading-tight">
                {description}
              </p>
            )}
          </div>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
              variantIconBg[variant]
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
