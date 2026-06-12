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

const variantGradients: Record<string, string> = {
  default: "from-primary/[0.08] to-transparent",
  success: "from-emerald-500/[0.1] to-transparent",
  warning: "from-amber-500/[0.1] to-transparent",
  danger: "from-red-500/[0.1] to-transparent",
};

const variantIconBg: Record<string, string> = {
  default: "bg-primary/[0.12] text-primary shadow-[0_0_12px_var(--primary)]",
  success: "bg-emerald-500/[0.15] text-emerald-400",
  warning: "bg-amber-500/[0.15] text-amber-400",
  danger: "bg-red-500/[0.15] text-red-400",
};

export function KPICard({ title, value, change, icon, description, trend, variant = "default" }: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const trendColor = trend === "up" || (trend === undefined && isPositive)
    ? "text-emerald-400"
    : trend === "down" || (trend === undefined && isNegative)
      ? "text-red-400"
      : "text-muted-foreground";

  return (
    <Card className={cn(
      "relative overflow-hidden border-border/40 glass-card group",
      "hover:border-primary/30 hover:shadow-[0_0_24px] hover:shadow-primary/[0.07] transition-all duration-300"
    )}>
      {/* Subtle gradient overlay */}
      <div className={cn(
        "absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
        variantGradients[variant]
      )} />
      <CardContent className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground/70">{title}</p>
            <p className="text-2xl font-semibold data-value tracking-tight leading-none">
              {value}
            </p>
            {change !== undefined && (
              <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
                {isPositive ? (
                  <TrendingUp className="h-3 w-3" />
                ) : isNegative ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                <span className="data-value">{isPositive ? "+" : ""}{change}%</span>
                <span className="text-muted-foreground font-normal">vs last month</span>
              </div>
            )}
            {description && (
              <p className="text-[11px] text-muted-foreground/60 leading-tight">{description}</p>
            )}
          </div>
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
            variantIconBg[variant]
          )}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
