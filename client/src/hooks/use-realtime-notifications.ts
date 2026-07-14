import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function useRealtimeNotifications() {
  const utils = trpc.useUtils();
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;

    function connect() {
      const es = new EventSource("/api/notifications/stream");
      esRef.current = es;

      es.addEventListener("alert_created", () => {
        if (mounted) {
          utils.alerts.invalidate();
        }
      });

      es.addEventListener("alert_updated", () => {
        if (mounted) {
          utils.alerts.invalidate();
        }
      });

      es.addEventListener("alert_deleted", () => {
        if (mounted) {
          utils.alerts.invalidate();
        }
      });

      es.onerror = () => {
        es.close();
        if (mounted) {
          reconnectRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectRef.current);
      esRef.current?.close();
    };
  }, [utils]);
}
