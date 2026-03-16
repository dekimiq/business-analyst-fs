import { env } from '@project/env'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Converts a given local time (HH:mm) strings using env.TZ into an equivalent
 * UTC hour and minute for the current day.
 */
export function convertLocalTimeToUTC(
  localHour: number,
  localMinute: number,
): { utcHour: number; utcMinute: number } {
  const timeZone = 'UTC' // Дефолт без кастомных TZ
  const now = new Date()

  // Получить текущее значение YYYY-MM-DD в целевом часовом поясе для корректной обработки летнего времени
  const year = formatInTimeZone(now, timeZone, 'yyyy')
  const month = formatInTimeZone(now, timeZone, 'MM')
  const day = formatInTimeZone(now, timeZone, 'dd')

  const hh = String(localHour).padStart(2, '0')
  const mm = String(localMinute).padStart(2, '0')

  // Построить строку ISO без индикатора часового пояса
  const dateString = `${year}-${month}-${day}T${hh}:${mm}:00`

  const utcDate = fromZonedTime(dateString, timeZone)

  const utcH = formatInTimeZone(utcDate, 'UTC', 'HH')
  const utcM = formatInTimeZone(utcDate, 'UTC', 'mm')

  return {
    utcHour: parseInt(utcH, 10),
    utcMinute: parseInt(utcM, 10),
  }
}
