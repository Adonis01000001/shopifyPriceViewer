import { trpc } from "@/lib/trpc";

/**
 * Empty screens look identical whether the app is working or has nothing to
 * say. This lets a screen tell the difference, so a first run reads as
 * "we are looking" rather than "there is nothing here".
 */
export function usePipelineRun(storeId?: string) {
  const { data } = trpc.pipeline.status.useQuery(
    storeId ? { storeId } : undefined,
    {
      // Do not poll an idle dashboard. Explicit Sync/import actions invalidate
      // this query, and an active run gets a slower progress refresh here.
      refetchInterval: query => (query.state.data?.running ? 30000 : false),
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }
  );

  const running = data?.running ?? false;
  const total = data?.total ?? 0;
  const done = data?.done ?? 0;

  return {
    running,
    total,
    done,
    current: data?.current ?? null,
    /** One line a screen can show in place of an empty state. */
    progressLabel: running
      ? total > 0
        ? `Looking now — ${done} of ${total} products checked`
        : "Looking now"
      : null,
  };
}
