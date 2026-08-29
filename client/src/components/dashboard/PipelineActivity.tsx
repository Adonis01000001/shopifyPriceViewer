import { useEffect, useRef, useState } from "react";
import { Activity, Check, CircleSlash, Loader2, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";

// Polling costs a request every time. Fast enough to feel live while a run is
// going, slow when there is nothing to watch, and stopped entirely when the tab
// is in the background.
const POLL_RUNNING_MS = 6000;
const POLL_IDLE_MS = 60000;

function relativeTime(value: Date | string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function duration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * The pipeline runs on its own after a sync or an import, which used to be
 * invisible: pages sat still while rows appeared underneath them. This reports
 * what the run is doing and nudges the open page to refetch as results land.
 */
export default function PipelineActivity({ storeId }: { storeId?: string }) {
  const [open, setOpen] = useState(false);
  const [pollMs, setPollMs] = useState<number>(POLL_IDLE_MS);
  const wrapRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const lastDoneRef = useRef(0);

  const { data } = trpc.pipeline.status.useQuery(
    storeId ? { storeId } : undefined,
    {
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    }
  );

  useEffect(() => {
    setPollMs(data?.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
  }, [data?.running]);

  // Each finished product means new rows for whatever page is open.
  useEffect(() => {
    const done = data?.done ?? 0;
    if (done === lastDoneRef.current) return;
    lastDoneRef.current = done;
    void utils.competitors.list.invalidate(
      storeId ? { storeId } : undefined
    );
    void utils.competitors.stats.invalidate(
      storeId ? { storeId } : undefined
    );
    void utils.products.list.invalidate(storeId ? { storeId } : undefined);
    void utils.products.stats.invalidate(storeId ? { storeId } : undefined);
    void utils.recommendations.list.invalidate(
      storeId ? { storeId } : undefined
    );
  }, [data?.done, storeId, utils]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!data) return null;

  const { running, total, done, current, steps, events, lastRun } = data;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="app-pipeline-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`app-pipeline-chip${running ? " is-running" : ""}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="pipeline-activity"
        title={
          running
            ? `Checking prices: ${done} of ${total} products`
            : "Background activity"
        }
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Activity className="h-3.5 w-3.5" />
        )}
        <span className="app-pipeline-chip-label">
          {running ? `Checking prices ${done}/${total}` : "Idle"}
        </span>
      </button>

      {open && (
        <div className="app-pipeline-popover" id="pipeline-activity">
          <div className="app-popover-header">
            <span className="app-popover-title">Background activity</span>
            {running && (
              <span className="app-pipeline-percent">{percent}%</span>
            )}
          </div>

          {running ? (
            <div className="app-pipeline-progress-block">
              <div
                className="app-pipeline-bar"
                role="progressbar"
                aria-valuenow={done}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-label="Products checked"
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="app-pipeline-current">
                {current ? current : "Starting the next product"}
              </p>
              {steps.length > 0 && (
                <ol className="app-pipeline-steps">
                  {steps.slice(0, 8).map((entry, index) => (
                    <li
                      key={`${String(entry.at)}-${index}`}
                      className={index === 0 ? "is-latest" : undefined}
                    >
                      {entry.detail}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p className="app-pipeline-current">
              Nothing running. Prices refresh once a day, and a sync or a CSV
              import starts a run straight away.
            </p>
          )}

          {events.length > 0 && (
            <ul className="app-pipeline-events">
              {events.map(event => (
                <li key={`${event.title}-${String(event.at)}`}>
                  <span className="app-pipeline-event-icon">
                    {event.failed ? (
                      <TriangleAlert className="h-3 w-3 text-[var(--destructive)]" />
                    ) : event.recommendedPrice != null ? (
                      <Check className="h-3 w-3 text-[var(--success)]" />
                    ) : (
                      <CircleSlash className="h-3 w-3 text-muted-foreground" />
                    )}
                  </span>
                  <span className="app-pipeline-event-title">
                    {event.title}
                  </span>
                  <span className="app-pipeline-event-detail">
                    {event.failed
                      ? "could not be checked"
                      : event.recommendedPrice != null
                        ? `${event.matched} matched → $${event.recommendedPrice.toFixed(2)}${
                            event.marginProtectionApplied ? " (floor)" : ""
                          }`
                        : (event.skipped ?? "no confident matches")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {lastRun && (
            <div className="app-pipeline-footer">
              Last full run {relativeTime(lastRun.finishedAt)} ·{" "}
              {duration(lastRun.durationMs)} · {lastRun.recommended}{" "}
              recommendation{lastRun.recommended === 1 ? "" : "s"} from{" "}
              {lastRun.products} products
            </div>
          )}
        </div>
      )}
    </div>
  );
}
