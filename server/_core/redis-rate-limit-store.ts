import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import Redis from "ioredis";

const INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if current == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = ARGV[1]
end
return { current, ttl }
`;

/**
 * Distributed express-rate-limit store backed by Redis.
 *
 * The increment and first-request expiration are one atomic Redis operation,
 * so concurrent application instances cannot reset or bypass a window.
 */
export class RedisRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;

  private windowMs = 60_000;

  constructor(
    private readonly redis: Redis,
    namespace: string
  ) {
    this.prefix = `rate-limit:${namespace}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      1,
      this.key(key),
      this.windowMs
    )) as [number | string, number | string];
    const totalHits = Number(result[0]);
    const ttlMs = Math.max(Number(result[1]), 0);

    return {
      totalHits,
      resetTime: new Date(Date.now() + ttlMs),
    };
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const redisKey = this.key(key);
    const [value, ttl] = await Promise.all([
      this.redis.get(redisKey),
      this.redis.pttl(redisKey),
    ]);

    if (value === null || ttl === -2) return undefined;

    return {
      totalHits: Number(value),
      resetTime: new Date(
        Date.now() + Math.max(ttl < 0 ? this.windowMs : ttl, 0)
      ),
    };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = this.key(key);
    const remaining = await this.redis.decr(redisKey);
    if (remaining <= 0) await this.redis.del(redisKey);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }
}
