import { Queue } from 'bullmq'
import { env } from '@project/env'
import cron from 'node-cron'
import { db, parseTime, ScheduleRecord } from './db.js'
import { convertLocalTimeToUTC } from './timeConverter.js'
import { BotNotifier } from './services/botNotifier.js'

// --- BullMQ Queues setup --- //
const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
}

// sync queue maps to db:0 normally
const syncQueue = new Queue('sync', {
  connection: { ...connection, db: env.REDIS_DB_BACKEND },
})

// reports queue maps to db:1
const reportsQueue = new Queue('reports', {
  connection: { ...connection, db: env.REDIS_DB_BOT },
})

// Store active cron tasks so we can clear them on reload
let activeTasks: cron.ScheduledTask[] = []

/**
 * Clears all existing active scheduled tasks.
 */
function clearSchedules() {
  activeTasks.forEach((task) => task.stop())
  activeTasks = []
}

/**
 * Common configuration for our BullMQ jobs:
 * `attempts: 1` -> do not retry on fail.
 */
const jobOpts = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

/**
 * Periodically reads DB schedules, translates to UTC using env.TZ,
 * and recreates node-cron tasks.
 */
export async function reloadSchedules() {
  try {
    const schedules = await db<ScheduleRecord>('schedules').select('*')
    clearSchedules()

    for (const schedule of schedules) {
      const parsed = parseTime(schedule.time_hh_mm)
      if (!parsed) {
        console.error(
          `[ERROR]: [ Node-Cron.reloadSchedules ] Invalid time format for schedule ${schedule.name}: ${schedule.time_hh_mm}`,
        )
        continue
      }

      // Convert local time to UTC
      const { utcHour, utcMinute } = convertLocalTimeToUTC(parsed.hour, parsed.minute)

      // Format cron expression: "Minute Hour * * DayOfWeek"
      const currentDayOfWeek = schedule.day_of_week === null ? '*' : schedule.day_of_week
      const cronExpression = `${utcMinute} ${utcHour} * * ${currentDayOfWeek}`

      console.log(
        `[INFO]: [ Node-Cron.reloadSchedules ] Loaded ${schedule.name} at local ${schedule.time_hh_mm} (TZ: ${env.TZ}) -> UTC Cron: ${cronExpression}`,
      )

      // Create new cron task
      const task = cron.schedule(
        cronExpression,
        async () => {
          console.log(`[INFO]: [ Node-Cron.job ] Trigger ${schedule.name}`)
          try {
            switch (schedule.name) {
              case 'sync':
                await syncQueue.add('sync_all', { trigger: 'cron' }, jobOpts)
                break
              case 'daily_report':
                await reportsQueue.add('daily_report', { trigger: 'cron' }, jobOpts)
                break
              case 'weekly_report':
                await reportsQueue.add('weekly_report', { trigger: 'cron' }, jobOpts)
                break
              default:
                console.warn(`[WARNING]: [ Node-Cron.job ] Unknown schedule name: ${schedule.name}`)
            }
          } catch (e) {
            await BotNotifier.notifyAlert(`Job Execution Trigger: ${schedule.name}`, e)
          }
        },
        {
          timezone: 'UTC', // We manually enforce UTC because we calculated exact UTC time above
        },
      )

      activeTasks.push(task)
    }
  } catch (error) {
    await BotNotifier.notifyAlert('Reload Schedules DB fetch', error)
  }
}
