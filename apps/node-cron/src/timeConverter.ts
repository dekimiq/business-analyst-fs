import { env } from '@project/env'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Преобразует заданное локальное время (ЧЧ:мм) с использованием env.TZ
 * в эквивалентный час и минуту UTC для текущего дня.
 */
export function convertLocalTimeToUTC(
  localHour: number,
  localMinute: number,
): { utcHour: number; utcMinute: number } {
  const timeZone = env.BUSINESS_TZ || 'UTC' // Используем BUSINESS_TZ из окружения или UTC по умолчанию
  const now = new Date()

  // Получаем текущие значения YYYY-MM-DD в целевом часовом поясе для корректной обработки летнего времени
  const year = formatInTimeZone(now, timeZone, 'yyyy')
  const month = formatInTimeZone(now, timeZone, 'MM')
  const day = formatInTimeZone(now, timeZone, 'dd')

  const hh = String(localHour).padStart(2, '0')
  const mm = String(localMinute).padStart(2, '0')

  // Строим строку ISO без указания часового пояса
  const dateString = `${year}-${month}-${day}T${hh}:${mm}:00`

  // Преобразуем из локального времени (в ZONE) в UTC объект Date
  const utcDate = fromZonedTime(dateString, timeZone)

  // Форматируем результат обратно в ЧЧ и мм в формате UTC
  const utcH = formatInTimeZone(utcDate, 'UTC', 'HH')
  const utcM = formatInTimeZone(utcDate, 'UTC', 'mm')

  return {
    utcHour: parseInt(utcH, 10),
    utcMinute: parseInt(utcM, 10),
  }
}
