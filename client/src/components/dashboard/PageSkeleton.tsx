import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PageSkeletonProps {
  title?: boolean;
  header?: string;
  cards?: number;
  className?: string;
}

export function PageSkeleton({ title = true, header, cards = 4, className }: PageSkeletonProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {title && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48 rounded-lg" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}
      {header && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      )}
      <div className={cn("grid gap-4", cards > 1 ? "sm:grid-cols-2 lg:grid-cols-4" : "")}>
        {Array.from({ length: Math.min(cards, 4) }).map((_, i) => (
          <div key={i} className="glass-card p-5 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-2 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass-panel rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.04]">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="divide-y divide-outline-variant/20">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-5 py-3 flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
