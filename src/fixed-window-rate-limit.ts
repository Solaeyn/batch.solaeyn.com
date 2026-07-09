export type FixedWindowRateLimitRule = {
  key: string;
  limit: number;
};

export type FixedWindowRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type RedisEvalClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

const FIXED_WINDOW_SCRIPT = `
local window = tonumber(ARGV[1])
local retry_after = 0

for index, key in ipairs(KEYS) do
  local count = tonumber(redis.call("GET", key) or "0")
  local limit = tonumber(ARGV[index + 1])
  local ttl = redis.call("TTL", key)

  if ttl < 0 then
    if count > 0 then
      redis.call("EXPIRE", key, window)
    end
    ttl = window
  end

  if count >= limit and ttl > retry_after then
    retry_after = ttl
  end
end

if retry_after > 0 then
  return {0, retry_after}
end

for _, key in ipairs(KEYS) do
  local count = redis.call("INCR", key)
  if count == 1 then
    redis.call("EXPIRE", key, window)
  end
end

return {1, window}
`;

export async function consumeFixedWindow(
  redis: RedisEvalClient,
  rules: FixedWindowRateLimitRule[],
  windowSeconds: number
): Promise<FixedWindowRateLimitResult> {
  if (!rules.length) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const safeWindow = Math.max(1, Math.floor(windowSeconds));
  const keys = rules.map((rule) => rule.key);
  const limits = rules.map((rule) => Math.max(1, Math.floor(rule.limit)));
  const raw = await redis.eval(
    FIXED_WINDOW_SCRIPT,
    keys.length,
    ...keys,
    safeWindow,
    ...limits
  );
  const result = Array.isArray(raw) ? raw : [];

  return {
    allowed: Number(result[0]) === 1,
    retryAfterSeconds: Math.max(1, Number(result[1]) || safeWindow)
  };
}
