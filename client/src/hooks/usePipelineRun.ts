import { trpc } from "@/lib/trpc";

/**
 * Empty screens look identical whether the app is working or has nothing to
 * say. This lets a screen tell the difference, so a first run reads as
 * "we are looking" rather than "there is nothing here".
 */
export function usePipelineRun(storeId?: string) {
  const { data } = trpc.pipeline.status.useQuery(storeId ? { storeId } : undefined, {
    // The indicator in the top bar already polls this same query, and
    // react-query shares one request between them. Asking for a slower
    // interval here keeps this from being the one that sets the pace.
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

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
