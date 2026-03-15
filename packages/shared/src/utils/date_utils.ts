import { DateTime } from 'luxon'
import { env } from '@project/env'

export const BUSINESS_TIMEZONE = env.TZ ?? 'Europe/Moscow'

/**
 * Получить текущую дату-время в бизнес- timezone.
 */
export const nowInBusinessTz = (): DateTime => DateTime.now().setZone(BUSINESS_TIMEZONE)

/**
 * Получить "вчера" в бизнес- timezone (начало дня).
 * Используется для определения даты последней синхронизации.
 * Синхронизация запускается в 3:00 ночи, поэтому загружаются данные за "вчера".
 */
export const yesterdayInBusinessTz = (): DateTime =>
  nowInBusinessTz().minus({ days: 1 }).startOf('day')

/**
 * Получить дату n дней назад в бизнес- timezone (начало дня).
 */
export const daysAgoInBusinessTz = (days: number): DateTime =>
  nowInBusinessTz().minus({ days }).startOf('day')
