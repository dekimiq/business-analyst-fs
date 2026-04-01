import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Поднимаемся из packages/env/src/ до корня монорепо
config({ path: resolve(__dirname, '../../../.env') })

const schema = z.object({
  BUSINESS_TZ: z.string().default('Europe/Moscow'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_HOST: z.string().default('postgres'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('analytics'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().default('postgres_root'),
  DB_USER_BACKEND: z.string().default('backend_user'),
  DB_PASSWORD_BACKEND: z.string().default('secret_backend'),
  DB_USER_BOT: z.string().default('bot_user'),
  DB_PASSWORD_BOT: z.string().default('secret_bot'),
  DB_USER_CRON: z.string().default('cron_user'),
  DB_PASSWORD_CRON: z.string().default('secret_cron'),
  DB_USER_AI: z.string().default('ai_user'),
  DB_PASSWORD_AI: z.string().default('secret_ai'),
  DB_USER_BOT_NOTIFICATION: z.string().default('bot_notification_user'),
  DB_PASSWORD_BOT_NOTIFICATION: z.string().default('secret_notification'),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_DB_BACKEND: z.coerce.number().default(0),
  REDIS_DB_BOT: z.coerce.number().default(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  USERNAME_DEV: z.string().optional(),
  USER_ID_DEV: z.string().optional(),
  BACKEND_API_URL: z.string().default('http://backend:3333'),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  APP_KEY: z.string().optional(),
  APP_URL: z.string().default('http://localhost:3333'),
  SESSION_DRIVER: z.enum(['cookie', 'memory', 'database']).default('memory'),

  // AI Configuration
  BASE_URL_AI: z.string().default('https://openrouter.ai/api/v1'),
  MODEL_NAME_AI: z.string().default('google/gemini-2.0-flash-001'),
  TOKEN_AI: z.string().optional(),
  AI_MODULE_URL: z.string().default('http://localhost:3334'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ ENV validation failed:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
