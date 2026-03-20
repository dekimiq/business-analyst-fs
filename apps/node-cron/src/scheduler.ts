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

const syncQueue = new Queue('sync', {
  connection: { ...connection, db: env.REDIS_DB_BACKEND },
})

const reportsQueue = new Queue('reports', {
  connection: { ...connection, db: env.REDIS_DB_BOT },
})

let activeTasks: cron.ScheduledTask[] = []

/**
 * Удаляет все существующие активные запланированные задачи.
 */
function clearSchedules() {
  activeTasks.forEach((task) => task.stop())
  activeTasks = []
}

/**
 * Общая конфигурация для задач BullMQ:
 * "попыток: 1" -> не повторять попытку в случае сбоя.
 */
const jobOpts = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

/**
 * Периодически считывает расписания из базы данных, переводит в UTC,
 * и заново создает задачи node-cron.
 */
export async function reloadSchedules() {
  try {
    const schedules = await db<ScheduleRecord>('schedules').select('*')
    clearSchedules()

    for (const schedule of schedules) {
      const parsed = parseTime(schedule.time_hh_mm)
      if (!parsed) {
        console.error(
          `[ERROR]: [ Node-Cron.reloadSchedules ] Неверный формат времени для расписания ${schedule.name}: ${schedule.time_hh_mm}`,
        )
        continue
      }

      let cronExpression = ''
      if (parsed.intervalStr) {
        cronExpression = `${parsed.intervalStr} * * * *`
      } else if (parsed.hour !== undefined && parsed.minute !== undefined) {
        const { utcHour, utcMinute } = convertLocalTimeToUTC(parsed.hour, parsed.minute)
        const currentDayOfWeek = schedule.day_of_week === null ? '*' : schedule.day_of_week
        cronExpression = `${utcMinute} ${utcHour} * * ${currentDayOfWeek}`
      } else {
        console.error(
          `[ERROR]: [ Node-Cron.reloadSchedules ] Не удалось разобрать время для расписания ${schedule.name}`,
        )
        continue
      }

      console.log(
        `[INFO]: [ Node-Cron.reloadSchedules ] Загружено ${schedule.name} на локальное время ${schedule.time_hh_mm} (TZ: ${env.BUSINESS_TZ}) -> UTC Cron: ${cronExpression}`,
      )

      const task = cron.schedule(
        cronExpression,
        async () => {
          console.log(`[INFO]: [ Node-Cron.job ] Запуск задачи ${schedule.name}`)
          try {
            switch (schedule.name) {
              case 'sync:crm':
                await syncQueue.add('sync:crm', { source: 'amocrm' }, jobOpts)
                break
              case 'sync:ads': {
                const metas = await db('integration_metadata')
                  .select('source')
                  .whereNot('source', 'amocrm')
                for (const meta of metas) {
                  await syncQueue.add(`sync:${meta.source}`, { source: meta.source }, jobOpts)
                }
                break
              }
              case 'daily_report':
                await reportsQueue.add('daily_report', { trigger: 'cron' }, jobOpts)
                break
              case 'weekly_report':
                await reportsQueue.add('weekly_report', { trigger: 'cron' }, jobOpts)
                break
              case 'logs:cleanup':
                await syncQueue.add('sync:cleanup', { months: 3 }, jobOpts)
                await BotNotifier.enqueueCleanup()
                break
              default:
                console.warn(
                  `[WARNING]: [ Node-Cron.job ] Неизвестное имя расписания: ${schedule.name}`,
                )
            }
          } catch (e) {
            await BotNotifier.notifyAlert(`Ошибка выполнения задачи: ${schedule.name}`, e)
          }
        },
        {
          timezone: 'UTC',
        },
      )

      activeTasks.push(task)
    }
  } catch (error) {
    await BotNotifier.notifyAlert('Ошибка получения расписаний из БД', error)
  }
}
