import { Skeleton } from "./ui/skeleton";

export function DashboardLayoutSkeleton() {
  return (
    <div className="app-shell" role="status" aria-label="Loading workspace">
      <aside className="app-sidebar hidden lg:flex" aria-hidden="true">
        <div className="app-sidebar-header">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2 w-20" />
            </div>
          </div>
        </div>
        <div className="app-navigation space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="mt-6 h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </aside>
      <div className="app-main">
        <div className="app-topbar">
          <Skeleton className="h-10 w-44 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
        <main className="app-content space-y-5">
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-10 w-64 rounded-xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-full" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </main>
      </div>
    </div>
  );
}
