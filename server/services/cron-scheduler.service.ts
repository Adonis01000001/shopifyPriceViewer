import { desc, eq } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import * as db from "../db";
import { cronRuns, users } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";
import { jobQueueService } from "./job-queue.service";
import { reportService } from "./report.service";
import { entitlementService } from "./entitlement.service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScheduledJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  lastRun: number;
  running: boolean;
  runOnStartup: boolean;
  daily?: {
    hour: number;
    minute: number;
    timeZone: string;
  };
}

type SchedulerTimer = ReturnType<typeof setTimeout>;

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  );
  return {
    year: values.get("year") ?? 0,
    month: values.get("month") ?? 0,
    day: values.get("day") ?? 0,
    hour: values.get("hour") ?? 0,
    minute: values.get("minute") ?? 0,
    second: values.get("second") ?? 0,
  };
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function localDateToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess =
    localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
  return localAsUtc - timezoneOffsetMs(new Date(firstGuess), timeZone);
}

/** Return the next wall-clock occurrence of a daily job in its configured TZ. */
export function getNextDailyRunAt(
  now: Date,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const current = zonedParts(now, timeZone);
  let target = localDateToUtc(
    current.year,
    current.month,
    current.day,
    hour,
    minute,
    timeZone
  );

  if (target <= now.getTime()) {
    const tomorrow = new Date(
      Date.UTC(current.year, current.month - 1, current.day + 1)
    );
    target = localDateToUtc(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      hour,
      minute,
      timeZone
    );
  }
  return target;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class CronScheduler {
  private jobs: ScheduledJob[] = [];
  private started = false;
  private intervalTimers = new Set<ReturnType<typeof setInterval>>();
  private startupTimers = new Set<ReturnType<typeof setTimeout>>();
  private dailyTimers = new Set<SchedulerTimer>();
  private activeRuns = new Set<Promise<void>>();

  register(
    name: string,
    intervalMs: number,
    handler: () => Promise<void>,
    options: { runOnStartup?: boolean } = {}
  ) {
    this.jobs.push({
      name,
      intervalMs,
      handler,
      lastRun: 0,
      running: false,
      runOnStartup: options.runOnStartup ?? true,
    });
    logger.info({ name, intervalMs }, "Cron job registered");
  }

  registerDaily(
    name: string,
    schedule: { hour: number; minute: number; timeZone: string },
    handler: () => Promise<void>
  ) {
    this.jobs.push({
      name,
      intervalMs: 24 * 60 * 60 * 1000,
      handler,
      lastRun: 0,
      running: false,
      runOnStartup: false,
      daily: schedule,
    });
    logger.info({ name, schedule }, "Daily cron job registered");
  }

  start() {
    if (this.started) return;
    this.started = true;
    logger.info({ jobs: this.jobs.length }, "Cron scheduler started");

    for (const job of this.jobs) {
      if (job.daily) {
        this.scheduleDaily(job);
      } else {
        if (job.runOnStartup) {
          const stagger = this.jobs.indexOf(job) * 5000;
          const startupTimer = setTimeout(() => {
            this.startupTimers.delete(startupTimer);
            void this.runJobOnStartup(job);
          }, stagger);
          this.startupTimers.add(startupTimer);
        }
        const intervalTimer = setInterval(
          () => void this.runJob(job),
          job.intervalMs
        );
        this.intervalTimers.add(intervalTimer);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.startupTimers.forEach(timer => clearTimeout(timer));
    this.intervalTimers.forEach(timer => clearInterval(timer));
    this.dailyTimers.forEach(timer => clearTimeout(timer));
    this.startupTimers.clear();
    this.intervalTimers.clear();
    this.dailyTimers.clear();
    this.started = false;

    if (this.activeRuns.size > 0) {
      logger.info(
        { activeJobs: this.activeRuns.size },
        "Waiting for active cron jobs to finish"
      );
      await Promise.allSettled(Array.from(this.activeRuns));
    }

    logger.info("Cron scheduler stopped");
  }

  private scheduleDaily(job: ScheduledJob) {
    if (!this.started || !job.daily) return;
    const nextRunAt = getNextDailyRunAt(
      new Date(),
      job.daily.hour,
      job.daily.minute,
      job.daily.timeZone
    );
    const timer = setTimeout(
      () => {
        this.dailyTimers.delete(timer);
        // Schedule from the wall clock before doing work so a long run does not
        // shift the daily schedule or create a catch-up loop.
        this.scheduleDaily(job);
        void this.runJob(job);
      },
      Math.max(1_000, nextRunAt - Date.now())
    );
    this.dailyTimers.add(timer);
    logger.info(
      {
        job: job.name,
        nextRunAt: new Date(nextRunAt).toISOString(),
        timeZone: job.daily.timeZone,
      },
      "Daily cron job scheduled"
    );
  }

  /**
   * A daily job should not run again just because the process restarted.
   * Discovery costs a paid search per product, so an afternoon of restarts
   * used to mean an afternoon of full runs. Ask the database when this job
   * last finished and honour the interval across restarts.
   */
  private async runJobOnStartup(job: ScheduledJob) {
    try {
      const database = await db.getDb();
      if (database) {
        const [previous] = await database
          .select({ startedAt: cronRuns.startedAt })
          .from(cronRuns)
          .where(eq(cronRuns.jobType, job.name))
          .orderBy(desc(cronRuns.startedAt))
          .limit(1);

        if (previous) {
          const since = Date.now() - previous.startedAt.getTime();
          if (since < job.intervalMs) {
            const dueIn = Math.round((job.intervalMs - since) / 60000);
            logger.info(
              { job: job.name, minutesUntilDue: dueIn },
              "Cron job ran recently, not repeating it on startup"
            );
            return;
          }
        }
      }
    } catch (err) {
      logger.warn({ job: job.name, err }, "Could not read the last cron run");
    }

    await this.runJob(job);
  }

  private async runJob(job: ScheduledJob) {
    if (job.running) {
      logger.warn({ job: job.name }, "Job still running, skipping this cycle");
      return;
    }
    job.running = true;
    job.lastRun = Date.now();
    void this.recordRun(job.name);

    const run = this.executeJob(job);
    this.activeRuns.add(run);
    try {
      await run;
    } finally {
      this.activeRuns.delete(run);
    }
  }

  /** Leaves the mark that runJobOnStartup reads after a restart. */
  private async recordRun(jobType: string) {
    try {
      const database = await db.getDb();
      if (database) {
        await database.insert(cronRuns).values({ jobType, status: "running" });
      }
    } catch (err) {
      logger.warn({ job: jobType, err }, "Could not record the cron run");
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    try {
      logger.info({ job: job.name }, "Cron job starting");
      await job.handler();
      logger.info({ job: job.name }, "Cron job completed");
    } catch (err) {
      logger.error({ job: job.name, err }, "Cron job failed");
    } finally {
      job.running = false;
    }
  }

  getStatus() {
    return this.jobs.map(j => ({
      name: j.name,
      intervalMs: j.intervalMs,
      lastRun: j.lastRun,
      running: j.running,
    }));
  }
}

export const cronScheduler = new CronScheduler();

// ─── Register Jobs ───────────────────────────────────────────────────────────

if (ENV.priceRefreshEnabled) {
  cronScheduler.registerDaily(
    "price_monitor",
    {
      hour: ENV.priceRefreshHour,
      minute: ENV.priceRefreshMinute,
      timeZone: ENV.priceRefreshTimezone,
    },
    async () => {
      if (jobQueueService.isEnabled) {
        await jobQueueService.withLock(
          "scheduler:price-monitor",
          24 * 60 * 60 * 1000 - 30_000,
          async () => {
            await jobQueueService.enqueuePriceMonitoring();
          }
        );
        return;
      }
      // Re-read the competitor pages we already know about. Discovery is not
      // repeated here: it is the expensive call and runs once per product.
      const { pipelineService } = await import("./pipeline.service");
      await pipelineService.refreshPrices();
    }
  );
} else {
  logger.info("Daily price refresh is disabled");
}

cronScheduler.register(
  "scraper_improvement_analysis",
  ENV.scraperImprovementIntervalHours * 60 * 60 * 1000,
  async () => {
    if (jobQueueService.isEnabled) {
      await jobQueueService.withLock(
        "scheduler:scraper-improvement",
        300_000,
        async () => {
          await jobQueueService.enqueueAiAnalysis();
        }
      );
      return;
    }
    const { scraperImprovementService } = await import(
      "./scraper-improvement.service"
    );
    await scraperImprovementService.analyzePendingFailures();
  }
);

cronScheduler.register("daily_reports", 24 * 60 * 60 * 1000, async () => {
  const work = async () => {
    const database = await requireDb();
    const allUsers = await database.select({ id: users.id }).from(users);
    for (const user of allUsers) {
      try {
        await entitlementService.assertFeature(user.id, "dailyReports");
        await reportService.queueReport(user.id, "daily_summary");
      } catch (error) {
        logger.warn(
          { userId: user.id, err: error },
          "Daily report generation failed"
        );
      }
    }
  };

  if (jobQueueService.isEnabled) {
    await jobQueueService.withLock("scheduler:daily-reports", 300_000, work);
    return;
  }
  await work();
});
