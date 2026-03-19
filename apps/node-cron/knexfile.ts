import 'dotenv/config'
import type { Knex } from 'knex'

/**
 * Поскольку мы читаем конфигурацию базы данных для knex,
 * нам нужны переменные окружения, которые лежат в корне монорепо.
 */
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config as dotenvConfig } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenvConfig({ path: resolve(__dirname, '../../.env') })

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'analytics',
      user: process.env.DB_USER_CRON ?? 'cron_user',
      password: process.env.DB_PASSWORD_CRON ?? 'secret_cron',
    },
    searchPath: ['settings', 'public'],
    pool: { min: 2, max: 10 },
    migrations: {
      tableName: 'knex_migrations_cron',
      directory: './migrations',
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: './seeds',
    },
  },
}

export default config
