import { env } from '@project/env'
import { reloadSchedules } from './scheduler.js'
import { BotNotifier } from './services/botNotifier.js'

async function bootstrap() {
  console.log('[INFO]: [ Node-Cron.bootstrap ] Starting Scheduler Service...')
  console.log(`[INFO]: [ Node-Cron.bootstrap ] Timezone: ${env.TZ}`)

  // Load schedules once on startup
  try {
    await reloadSchedules()
  } catch (startupError) {
    await BotNotifier.notifyAlert('Initial Schedule Reload', startupError)
  }

  // Then reload schedules every 10 minutes to detect DB changes and DST shifts
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
  // We do not process.exit(1) here anymore to keep the interval alive
  // if bootstrap crashes after setting up timers.
})
