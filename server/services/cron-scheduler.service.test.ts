import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { CronScheduler, getNextDailyRunAt } from "./cron-scheduler.service";

describe("daily price-refresh scheduling", () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:59:00.000Z"));
    vi.spyOn(db, "getDb").mockResolvedValue(null);
    scheduler = new CronScheduler();
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not run a daily job at startup", async () => {
    const handler = vi.fn(async () => undefined);
    scheduler.registerDaily(
      "price_monitor",
      { hour: 2, minute: 0, timeZone: "UTC" },
      handler
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).not.toHaveBeenCalled();
  });

  it("runs exactly once at the configured daily time and then stays idle", async () => {
    const handler = vi.fn(async () => undefined);
    scheduler.registerDaily(
      "price_monitor",
      { hour: 2, minute: 0, timeZone: "UTC" },
      handler
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("calculates the next occurrence in the configured timezone", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const next = getNextDailyRunAt(now, 9, 0, "America/New_York");

    expect(new Date(next).toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });
});
