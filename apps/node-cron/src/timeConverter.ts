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
  const timeZone = env.TZ || 'UTC'
  const now = new Date()

  // Get current YYYY-MM-DD in the target Timezone to handle DST correctly
  const year = formatInTimeZone(now, timeZone, 'yyyy')
  const month = formatInTimeZone(now, timeZone, 'MM')
  const day = formatInTimeZone(now, timeZone, 'dd')

  const hh = String(localHour).padStart(2, '0')
  const mm = String(localMinute).padStart(2, '0')

  // Construct ISO string without timezone indicator
  const dateString = `${year}-${month}-${day}T${hh}:${mm}:00`

  // Intepret this string as occurring in the desired Timezone to find the Absolute UTC time
  const utcDate = fromZonedTime(dateString, timeZone)

  // Now format the resulting Date object back to UTC hours and minutes
  const utcH = formatInTimeZone(utcDate, 'UTC', 'HH')
  const utcM = formatInTimeZone(utcDate, 'UTC', 'mm')

  return {
    utcHour: parseInt(utcH, 10),
    utcMinute: parseInt(utcM, 10),
  }
}
