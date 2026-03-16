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

export interface ScheduleRecord {
  name: string
  time_hh_mm: string
  day_of_week: number | null
}

/**
 * Преобразует строку HH:mm в допустимые часы и минуты.
 * Если строка представляет интервал (например, каждые 5 минут), она возвращает его напрямую.
 * Если неверный формат - возвращает значение undefined.
 */
export function parseTime(
  timeStr: string,
): { hour?: number; minute?: number; intervalStr?: string } | undefined {
  if (timeStr.startsWith('*/')) {
    return { intervalStr: timeStr }
  }

  const parts = timeStr.split(':')
  if (parts.length !== 2) return undefined

  const hour = parseInt(parts[0], 10)
  const minute = parseInt(parts[1], 10)

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined
  }

  return { hour, minute }
}
