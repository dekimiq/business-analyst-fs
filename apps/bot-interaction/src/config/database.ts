import knex from 'knex'
import { env } from '@project/env'

// Конфигурация Knex для схемы bot
export function createKnexConfig() {
  return {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER_BOT,
      password: env.DB_PASSWORD_BOT,
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations_bot',
      directory: '../../migrations',
      extension: 'ts',
    },
    searchPath: ['bot'],
  }
}

// Экземпляр Knex (создаётся при инициализации)
export function createDatabase() {
  return knex(createKnexConfig())
}
