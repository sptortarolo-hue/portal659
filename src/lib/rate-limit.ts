import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;
  const r = getRedis();
  if (!r) return null;
  ratelimit = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    analytics: true,
  });
  return ratelimit;
}

export async function checkRateLimit(
  key: string,
  maxRequests: number = 60
): Promise<{ allowed: boolean; remaining: number; headers: Record<string, string> }> {
  const rl = getRatelimit();
  if (!rl) {
    return {
      allowed: true,
      remaining: maxRequests,
      headers: {
        "X-RateLimit-Limit": String(maxRequests),
        "X-RateLimit-Remaining": String(maxRequests),
        "X-RateLimit-Reset": "60",
      },
    };
  }

  const { success, remaining } = await rl.limit(key);
  return {
    allowed: success,
    remaining: Math.min(remaining, maxRequests),
    headers: {
      "X-RateLimit-Limit": String(maxRequests),
      "X-RateLimit-Remaining": String(Math.max(0, remaining)),
      "X-RateLimit-Reset": "60",
    },
  };
}
