import { env } from '@project/env'

// Опции подключения Redis для BullMQ
// BullMQ использует bundled ioredis — передаём plain object вместо экземпляра Redis
export function createRedisOptions() {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB_BOT,
    maxRetriesPerRequest: null as null,
  }
}
