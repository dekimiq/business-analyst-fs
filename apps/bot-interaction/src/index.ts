import { createApp } from './app.js'
import { startBot, stopBot } from './services/bot.js'
import { stopWorkers } from './services/worker.js'
import { closeQueue } from './services/queue.js'
import { closeDb } from './database/client.js'
import { logger } from './utils/logger.js'

async function main(): Promise<void> {
  logger.info('Запуск сервиса bot-interaction...')

  const bot = await createApp()

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Получен сигнал ${signal}, завершение работы...`)
    await stopBot(bot)
    await stopWorkers()
    await closeQueue()
    await closeDb()
    logger.info('Завершение работы выполнено')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await startBot(bot)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
