import { DateTime } from 'luxon'

/**
 * Возвращает текущую дату и время в UTC
 */
export const nowUtc = () => DateTime.now().toUTC()

/**
 * Возвращает вчерашний день (начало дня) в UTC
 */
export const yesterdayUtc = () => nowUtc().minus({ days: 1 }).startOf('day')

/**
 * Возвращает дату N дней назад (начало дня) в UTC
 */
export const daysAgoUtc = (days: number) => nowUtc().minus({ days }).startOf('day')
/**
 * Возвращает границы прошлой недели (Пн-Вс) в указанном таймзоне
 */
export const getLastWeekBoundaries = (tz: string) => {
  const now = DateTime.now().setZone(tz)
  const lastWeekStart = now.minus({ weeks: 1 }).startOf('week')
  const lastWeekEnd = lastWeekStart.endOf('week')

  return {
    start: lastWeekStart,
    end: lastWeekEnd,
  }
}
