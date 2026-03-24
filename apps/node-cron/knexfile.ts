import 'dotenv/config'
import type { Knex } from 'knex'

/**
 * Унифицированный конфиг для любого окружения.
 */
const config: Knex.Config = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'analytics',
    user: process.env.DB_USER_CRON ?? 'cron_user',
    password: process.env.DB_PASSWORD_CRON ?? 'secret_cron',
  },
  searchPath: ['settings', 'public'],
  pool: {
    min: 2,
    max: process.env.NODE_ENV === 'production' ? 20 : 10,
  },
  migrations: {
    tableName: 'knex_migrations_cron',
    directory: './migrations',
  },
  seeds: {
    directory: './seeds',
  },
}

export default config
