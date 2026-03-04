import knex from 'knex'
import { env } from '@project/env'

export const db = knex({
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER_CRON,
    password: env.DB_PASSWORD_CRON,
    database: env.DB_NAME,
  },
  searchPath: ['settings', 'public'],
})

/**
 * Interface representing schedule row in the database.
 */
export interface ScheduleRecord {
  name: string
  time_hh_mm: string
  day_of_week: number | null
}

/**
 * Parses a HH:mm string to a valid hour and minute.
 * If invalid format - returns undefined.
 */
export function parseTime(timeStr: string): { hour: number; minute: number } | undefined {
  const parts = timeStr.split(':')
  if (parts.length !== 2) return undefined

  const hour = parseInt(parts[0], 10)
  const minute = parseInt(parts[1], 10)

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined
  }

  return { hour, minute }
}
