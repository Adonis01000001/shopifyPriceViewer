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
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class CronScheduler {
  private jobs: ScheduledJob[] = [];
  private started = false;
  private intervalTimers = new Set<ReturnType<typeof setInterval>>();
  private startupTimers = new Set<ReturnType<typeof setTimeout>>();
  private activeRuns = new Set<Promise<void>>();

  register(name: string, intervalMs: number, handler: () => Promise<void>) {
    this.jobs.push({ name, intervalMs, handler, lastRun: 0, running: false });
    logger.info({ name, intervalMs }, "Cron job registered");
  }

  start() {
    if (this.started) return;
    this.started = true;
    logger.info({ jobs: this.jobs.length }, "Cron scheduler started");

    for (const job of this.jobs) {
      const stagger = this.jobs.indexOf(job) * 5000;
      const startupTimer = setTimeout(() => {
        this.startupTimers.delete(startupTimer);
        void this.runJobOnStartup(job);
      }, stagger);
      this.startupTimers.add(startupTimer);
      const intervalTimer = setInterval(
        () => void this.runJob(job),
        job.intervalMs
      );
      this.intervalTimers.add(intervalTimer);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.startupTimers.forEach(timer => clearTimeout(timer));
    this.intervalTimers.forEach(timer => clearInterval(timer));
    this.startupTimers.clear();
    this.intervalTimers.clear();
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

cronScheduler.register(
  "price_monitor",
  ENV.monitoringIntervalHours * 60 * 60 * 1000,
  async () => {
    if (jobQueueService.isEnabled) {
      await jobQueueService.withLock(
        "scheduler:price-monitor",
        Math.max(ENV.monitoringIntervalHours * 3_600_000 - 30_000, 60_000),
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

cronScheduler.register(
  "competitor_discovery",
  24 * 60 * 60 * 1000,
  async () => {
    const database = await requireDb();
    const allUsers = await database.select({ id: users.id }).from(users);
    if (jobQueueService.isEnabled) {
      await Promise.all(
        allUsers.map(user => jobQueueService.enqueueCompetitorDiscovery(user.id))
      );
      return;
    }
    const concurrency = Math.min(4, Math.max(1, ENV.maxConcurrentScrapes));
    for (let offset = 0; offset < allUsers.length; offset += concurrency) {
      const batch = allUsers.slice(offset, offset + concurrency);
      await Promise.all(
        batch.map(async user => {
          try {
            const { pipelineService } = await import("./pipeline.service");
            await pipelineService.runForUser(user.id);
          } catch (err) {
            logger.warn(
              { userId: user.id, err },
              "Auto-discovery failed for user"
            );
          }
        })
      );
    }
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
