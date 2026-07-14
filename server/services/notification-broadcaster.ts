import { EventEmitter } from "events";

export type BroadcastEvent = {
  type: "alert_created" | "alert_updated" | "alert_deleted";
  userId: string;
  payload: Record<string, unknown>;
};

class NotificationBroadcaster extends EventEmitter {
  static readonly NEW_ALERT = "alert";

  broadcast(event: BroadcastEvent): void {
    this.emit(NotificationBroadcaster.NEW_ALERT, event);
  }

  subscribe(callback: (event: BroadcastEvent) => void): () => void {
    this.on(NotificationBroadcaster.NEW_ALERT, callback);
    return () => {
      this.off(NotificationBroadcaster.NEW_ALERT, callback);
    };
  }
}

export const notificationBroadcaster = new NotificationBroadcaster();
