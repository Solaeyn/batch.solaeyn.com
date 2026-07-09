import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SESSION_TTL = Number(process.env.SESSION_TTL_SECONDS) || 60 * 60 * 24 * 30;

let redis: Redis | null = null;

export function getRedis() {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      }
    });

    redis.on("error", (err) => {
      console.error("Redis error:", err.message);
    });
  }

  return redis;
}

export async function connectRedis() {
  const client = getRedis();
  await client.connect();
  return client;
}

function sessionKey(sid: string) {
  return `sess:${sid}`;
}

export async function getSession(sid: string) {
  if (!sid) return null;

  const raw = await getRedis().get(sessionKey(sid));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function touchSession(sid: string, sessionData?: Record<string, unknown>) {
  if (!sid) return;

  const session = sessionData || await getSession(sid);
  if (!session) return;

  const updated = {
    ...session,
    lastSeenAt: Date.now()
  };

  await getRedis().set(sessionKey(sid), JSON.stringify(updated), "EX", SESSION_TTL);
}

export async function destroySession(sid: string) {
  if (!sid) return;

  const session = await getSession(sid);
  await getRedis().del(sessionKey(sid));

  if (session?.userId) {
    await getRedis().srem(`user_sessions:${session.userId}`, sid);
  }
}

export async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
