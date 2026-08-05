import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { closeDb } from "../db";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { competitorDiscoveryService } from "../services/competitor-discovery.service";
import { priceMonitoringService } from "../services/price-monitoring.service";
import { reportEmailService } from "../services/report-email.service";
import type { UserJobPayload } from "../services/job-queue.service";

if (!ENV.redisUrl || ENV.queueMode !== "redis") {
  throw new Error("The worker requires QUEUE_MODE=redis and REDIS_URL");
}

const connection = new Redis(ENV.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

const workers = [
  new Worker<UserJobPayload>(
    "price-monitoring",
    job => priceMonitoringService.runFullMonitoring(job.data.userId),
    { connection, concurrency: ENV.workerConcurrency }
  ),
  new Worker<UserJobPayload>(
    "competitor-discovery",
    async job => {
      if (!job.data.userId)
        throw new Error("Competitor discovery job has no user ID");
      return competitorDiscoveryService.discoverForAllProducts(job.data.userId);
    },
    { connection, concurrency: ENV.workerConcurrency }
  ),
  new Worker<UserJobPayload>(
    "notifications",
    async job => {
      if (!job.data.reportRunId)
        throw new Error("Notification job has no report run ID");
      return reportEmailService.deliverReport(job.data.reportRunId);
    },
    { connection, concurrency: ENV.workerConcurrency }
  ),
];

for (const worker of workers) {
  worker.on("completed", job => {
    logger.info({ queue: worker.name, jobId: job.id }, "Worker job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { queue: worker.name, jobId: job?.id, err: error },
      "Worker job failed"
    );
  });
  worker.on("error", error => {
    logger.error({ queue: worker.name, err: error }, "Worker error");
  });
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Worker shutdown started");
  await Promise.all(workers.map(worker => worker.close()));
  await connection.quit();
  await closeDb();
  logger.info({ signal }, "Worker shutdown completed");
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
logger.info(
  { queues: workers.map(worker => worker.name) },
  "Worker process started"
);
