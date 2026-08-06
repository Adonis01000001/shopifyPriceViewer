import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PageSkeletonProps {
  title?: boolean;
  header?: string;
  cards?: number;
  className?: string;
}

export function PageSkeleton({
  title = true,
  header,
  cards = 4,
  className,
}: PageSkeletonProps) {
  return (
    <div
      className={cn("space-y-8", className)}
      role="status"
      aria-label="Loading page content"
    >
      {title && (
        <div className="page-header" aria-hidden="true">
          <div>
            <Skeleton className="h-2.5 w-28 rounded-full" />
            <Skeleton className="mt-3 h-9 w-52 rounded-lg" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-full" />
          </div>
        </div>
      )}
      {header && (
        <div className="flex items-center justify-between" aria-hidden="true">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      )}
      <div
        className={cn(
          "grid gap-4",
          cards > 1 ? "sm:grid-cols-2 lg:grid-cols-4" : ""
        )}
        aria-hidden="true"
      >
        {Array.from({ length: Math.min(cards, 4) }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-2 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" aria-hidden="true" />
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="glass-panel overflow-hidden rounded-2xl">
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
