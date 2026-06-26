import { requireDb } from "../_core/db-assert";
import { users } from "../../drizzle/schema";
import { priceMonitoringService } from "./price-monitoring.service";
import { competitorDiscoveryService } from "./competitor-discovery.service";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScheduledJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  lastRun: number;
  running: boolean;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

class CronScheduler {
  private jobs: ScheduledJob[] = [];
  private started = false;

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
      setTimeout(() => this.runJob(job), stagger);
      setInterval(() => this.runJob(job), job.intervalMs);
    }
  }

  private async runJob(job: ScheduledJob) {
    if (job.running) {
      logger.warn({ job: job.name }, "Job still running, skipping this cycle");
      return;
    }
    job.running = true;
    job.lastRun = Date.now();
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
    return this.jobs.map(j => ({ name: j.name, intervalMs: j.intervalMs, lastRun: j.lastRun, running: j.running }));
  }
}

export const cronScheduler = new CronScheduler();

// ─── Register Jobs ───────────────────────────────────────────────────────────

cronScheduler.register(
  "price_monitor",
  ENV.monitoringIntervalHours * 60 * 60 * 1000,
  async () => { await priceMonitoringService.runFullMonitoring(); },
);

cronScheduler.register(
  "competitor_discovery",
  24 * 60 * 60 * 1000,
  async () => {
    const database = await requireDb();
    const allUsers = await database.select({ id: users.id }).from(users);
    for (let i = 0; i < allUsers.length; i++) {
      try {
        await competitorDiscoveryService.discoverForAllProducts(allUsers[i].id);
      } catch (err) {
        logger.warn({ userId: allUsers[i].id, err }, "Auto-discovery failed for user");
      }
    }
  },
);
