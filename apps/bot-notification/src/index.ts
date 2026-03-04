import { Worker } from 'bullmq'
import { env } from '@project/env'
import { db, BotUser } from './db.js'
import { BotService } from './botService.js'

async function bootstrap() {
  console.log('[INFO]: [ Bot-Notification.bootstrap ] Starting Bot Notification Worker...')

  const connection = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB_BOT,
  }

  const worker = new Worker(
    'notifications',
    async (job) => {
      try {
        if (job.name === 'alert') {
          const { context, message } = job.data

          console.log(
            `[INFO]: [ Bot-Notification.worker ] Received an alert for context: ${context}`,
          )

          // Fetch all users with role = 'dev' from the bot schema
          const developers = await db<BotUser>('users').where({ role: 'dev' }).select('user_id')

          if (!developers || developers.length === 0) {
            console.warn(
              `[WARNING]: [ Bot-Notification.worker ] No developers found to notify for alert in context: ${context}.`,
            )
            return
          }

          const alertText = `🚨 *КРИТИЧЕСКАЯ ОШИБКА*\n\nКонтекст: ${context}\n\nОшибка:\n\`\`\`text\n${message}\n\`\`\``

          // Send message to each developer
          for (const dev of developers) {
            await BotService.sendAlertMessage(dev.user_id, alertText)
          }
        }
      } catch (innerError) {
        const errMsg =
          innerError instanceof Error ? innerError.stack || innerError.message : String(innerError)
        console.error(`[FATAL]: [ Bot-Notification.worker ] Unhandled Worker Exception: ${errMsg}`)
      }
    },
    { connection },
  )

  worker.on('ready', () => {
    console.log(
      '[INFO]: [ Bot-Notification.bootstrap ] Notifications Worker ready to process jobs on db1.',
    )
  })

  process.on('SIGTERM', async () => {
    console.log('[INFO]: [ Bot-Notification.bootstrap ] SIGTERM received. Closing worker...')
    await worker.close()
    process.exit(0)
  })
}

bootstrap().catch((err) => {
  const errMsg = err instanceof Error ? err.stack || err.message : String(err)
  console.error(
    `[FATAL]: [ Bot-Notification.bootstrap ] Critical bootstrap fallback error: ${errMsg}`,
  )
  // Do not process.exit(1) on failure, allow the container/worker runner to keep trying restarts
})
