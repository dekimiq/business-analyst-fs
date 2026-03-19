import { createBot } from './config/bot.js'
import { loggerMiddleware } from './middlewares/index.js'
import { initQueue } from './services/queue.js'
import { startWorkers } from './services/worker.js'
import type { Bot } from 'grammy'
import type { BotContext } from './types/index.js'
import { logger } from './utils/logger.js'

export async function createApp(): Promise<Bot<BotContext>> {
  const bot = createBot()

  bot.use(loggerMiddleware)

  initQueue()

  startWorkers(bot)

  logger.info('Приложение сконфигурировано')

  return bot
}
