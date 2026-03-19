import 'dotenv/config'
import type { Knex } from 'knex'

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? 'analytics',
      user: process.env.DB_USER_BOT ?? 'bot_user',
      password: process.env.DB_PASSWORD_BOT ?? 'secret_bot',
    },
    searchPath: ['bot'],
    pool: { min: 2, max: 10 },
    migrations: {
      tableName: 'knex_migrations_bot',
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
