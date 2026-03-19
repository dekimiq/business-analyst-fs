import type { Bot } from 'grammy'
import { logger } from '../utils/logger.js'
import type { BotContext } from '../types/index.js'

export async function startBot(bot: Bot<BotContext>): Promise<void> {
  bot.catch((err) => {
    logger.error('Ошибка бота', { ошибка: err.message })
  })

  await bot.start({
    onStart: (info) => {
      logger.info(`Бот запущен: @${info.username}`)
    },
  })
}

export async function stopBot(bot: Bot<BotContext>): Promise<void> {
  await bot.stop()
  logger.info('Бот остановлен')
}
