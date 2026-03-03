import { DateTime } from 'luxon'

export const YANDEX_TIMEZONE = 'Europe/Moscow'

export function getNow(): DateTime {
  return DateTime.now().setZone(YANDEX_TIMEZONE)
}

export function getToday(): DateTime {
  return getNow().startOf('day')
}

export function getYesterday(): DateTime {
  return getNow().minus({ days: 1 }).startOf('day')
}
