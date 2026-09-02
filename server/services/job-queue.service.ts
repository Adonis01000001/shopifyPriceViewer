import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";

export type QueueName =
  | "price-monitoring"
  | "competitor-discovery"
  | "notifications"
  | "ai-analysis";

export type UserJobPayload = {
  userId?: string;
  reportRunId?: string;
  analysisKind?: "scraper-improvement";
  failureId?: string;
  requestedAt: string;
};

const queueNames: QueueName[] = [
  "price-monitoring",
  "competitor-discovery",
  "notifications",
  "ai-analysis",
];

const redis =
  ENV.queueMode === "redis" && ENV.redisUrl
    ? new Redis(ENV.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      })
    : null;

redis?.on("error", error => {
  logger.error({ err: error }, "Redis queue connection error");
});

const queues = new Map<QueueName, Queue<UserJobPayload>>();

function getQueue(name: QueueName): Queue<UserJobPayload> | null {
  if (!redis) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue<UserJobPayload>(name, {
    connection: redis,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
    },
  });
  queues.set(name, queue);
  return queue;
}

async function enqueue(
  name: QueueName,
  jobId: string,
  data: UserJobPayload
): Promise<string | null> {
  const queue = getQueue(name);
  if (!queue) return null;
  const job = await queue.add(name, data, { jobId });
  return job.id ?? jobId;
}

export const jobQueueService = {
  isEnabled: Boolean(redis),
  queueNames,

  async enqueuePriceMonitoring(userId?: string) {
    const bucket = Math.floor(Date.now() / 86_400_000);
    return enqueue(
      "price-monitoring",
      `price-monitoring:${userId ?? "all"}:${bucket}`,
      { userId, requestedAt: new Date().toISOString() }
    );
  },

  async enqueueCompetitorDiscovery(userId: string) {
    const bucket = Math.floor(Date.now() / 86_400_000);
    return enqueue(
      "competitor-discovery",
      `competitor-discovery:${userId}:${bucket}`,
      { userId, requestedAt: new Date().toISOString() }
    );
  },

  async enqueueNotification(userId: string, reportRunId?: string) {
    return enqueue("notifications", `notification:${userId}:${Date.now()}`, {
      userId,
      reportRunId,
      requestedAt: new Date().toISOString(),
    });
  },

  async enqueueAiAnalysis(failureId?: string) {
    const bucket = Math.floor(Date.now() / 300_000);
    return enqueue("ai-analysis", `scraper-improvement:${bucket}`, {
      analysisKind: "scraper-improvement",
      failureId,
      requestedAt: new Date().toISOString(),
    });
  },

  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>) {
    if (!redis) return work();
    const token = randomUUID();
    const acquired = await redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
    if (acquired !== "OK") return null;
    try {
      return await work();
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        `lock:${key}`,
        token
      );
    }
  },

  async getHealth() {
    if (!redis) return { enabled: false, queues: {} };
    const queueCounts = await Promise.all(
      queueNames.map(async name => {
        const queue = getQueue(name);
        const counts = queue
          ? await queue.getJobCounts(
              "waiting",
              "active",
              "completed",
              "failed",
              "delayed"
            )
          : {};
        return [name, counts] as const;
      })
    );
    return {
      enabled: true,
      redisStatus: redis.status,
      queues: Object.fromEntries(queueCounts),
    };
  },

  async close() {
    await Promise.all(Array.from(queues.values()).map(queue => queue.close()));
    queues.clear();
    await redis?.quit();
  },
};
