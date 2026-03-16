import { env } from '@project/env'
import { reloadSchedules } from './scheduler.js'
import { BotNotifier } from './services/botNotifier.js'

async function bootstrap() {
  console.log('[INFO]: [ Node-Cron.bootstrap ] Starting Scheduler Service...')
  console.log(`[INFO]: [ Node-Cron.bootstrap ] Timezone: ${env.TZ}`)

  // Загрузка расписания единожды при запуске
  try {
    await reloadSchedules()
  } catch (startupError) {
    await BotNotifier.notifyAlert('Initial Schedule Reload', startupError)
  }

  // Обновление расписания каждый 10 минут, чтобы обнаружить изменения в базе данных и переходы на летнее время
  const RELOAD_INTERVAL_MS = 10 * 60 * 1000
  setInterval(async () => {
    try {
      console.log('[INFO]: [ Node-Cron.interval ] Periodic schedule reload...')
      await reloadSchedules()
    } catch (periodicError) {
      await BotNotifier.notifyAlert('Periodic Schedule Reload', periodicError)
    }
  }, RELOAD_INTERVAL_MS)
}

bootstrap().catch(async (err) => {
  await BotNotifier.notifyAlert('Node-Cron Fatal Bootstrap', err)
})
