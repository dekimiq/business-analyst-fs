import knex from 'knex'
import { env } from '@project/env'

export const db = knex({
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER_BOT_NOTIFICATION,
    password: env.DB_PASSWORD_BOT_NOTIFICATION,
    database: env.DB_NAME,
  },
  searchPath: ['bot', 'public'],
})

export interface BotUser {
  id: number
  user_id: string
  username: string | null
  role: 'user' | 'dev' | 'admin'
  created_at: Date
  updated_at: Date
}
