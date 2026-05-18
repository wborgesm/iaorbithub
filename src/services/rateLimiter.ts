import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })
redis.connect().catch(console.error)

export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, windowSeconds)
  }
  return current <= limit
}

export async function getRateLimitCount(key: string): Promise<number> {
  const val = await redis.get(key)
  return val ? parseInt(val, 10) : 0
}
