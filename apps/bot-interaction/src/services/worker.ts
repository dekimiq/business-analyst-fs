import type { Worker } from 'bullmq'
import type { Bot } from 'grammy'
import { startNotificationConsumer } from '../modules/notifications/consumer.js'
import { logger } from '../utils/logger.js'
import type { BotContext } from '../types/index.js'

let notificationWorker: Worker | null = null

export function startWorkers(bot: Bot<BotContext>): void {
  notificationWorker = startNotificationConsumer(bot)
  logger.info('Воркеры запущены')
}

export async function stopWorkers(): Promise<void> {
  if (notificationWorker) {
    await notificationWorker.close()
    notificationWorker = null
    logger.info('Воркеры остановлены')
  }
}
