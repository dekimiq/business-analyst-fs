import { Queue } from 'bullmq'
import { env } from '@project/env'

// Notifications queue maps to db:1
const notificationsQueue = new Queue('notifications', {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB_BOT, // bot interaction DB for notifications
  },
})

/**
 * Bot Notification Service Stub
 *
 * This service is responsible for handling all critical module failures
 * and sending an alert (e.g., to Telegram or via `bot-interaction` API).
 */
export class BotNotifier {
  /**
   * Notifies developers or the monitoring system about an error.
   *
   * @param context Where the error occurred (e.g., 'Scheduler Reload', 'Database Init')
   * @param error The thrown error object
   */
  static async notifyAlert(context: string, error: unknown): Promise<void> {
    try {
      const errMessage = error instanceof Error ? error.stack || error.message : String(error)
      const formattedLog =
        `\n[FATAL]: [ Node-Cron.BotNotifier ] -----------------\n` +
        `Context: ${context}\n` +
        `Message: ${errMessage}\n` +
        `------------------------------------------------------------\n`

      console.error(formattedLog)

      // Add to BullMQ for the bot-notification service to pick up
      await notificationsQueue.add(
        'alert',
        {
          context,
          message: errMessage,
        },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        },
      )
    } catch (notifierError) {
      // Failsafe: if the notifier itself fails, log to standard error output
      console.error(
        '[FATAL]: [ Node-Cron.BotNotifier ] Failed to send alert! Internal Error:',
        notifierError,
      )
      console.error('[INFO]: [ Node-Cron.BotNotifier ] Original error was:', error)
    }
  }

  static async enqueueCleanup(): Promise<void> {
    try {
      await notificationsQueue.add(
        'cleanup',
        {},
        {
          removeOnComplete: true,
          removeOnFail: true,
        },
      )
    } catch (error) {
      console.error('[FATAL]: [ Node-Cron.BotNotifier ] Failed to enqueue cleanup job', error)
    }
  }
}
