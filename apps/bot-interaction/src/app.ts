import { Keyboard } from 'grammy'
import { createBot } from './config/bot.js'
import { loggerMiddleware, authMiddleware } from './middlewares/index.js'
import { initQueue } from './services/queue.js'
import { startWorkers } from './services/worker.js'
import type { Bot } from 'grammy'
import type { BotContext } from './types/index.js'
import { logger } from './utils/logger.js'

import { aiService } from './services/aiService.js'
import { TelegramFormatter } from './utils/telegram_formatter.js'

// Главное меню с кнопками
const mainMenu = new Keyboard().text('📊 Недельный отчет').resized()

export async function createApp(): Promise<Bot<BotContext>> {
  const bot = createBot()

  bot.use(loggerMiddleware)
  bot.use(authMiddleware)

  // Обработчик кнопки Недельный отчет
  bot.hears('📊 Недельный отчет', async (ctx) => {
    let waitMsgId: number | undefined
    try {
      const waitMsg = await ctx.reply(
        '⏳ Начинаю сбор аналитики и генерацию отчета... Это может занять около 1-2 минут.',
      )
      waitMsgId = waitMsg.message_id

      // 1. Вызов AI модуля
      const reportMarkdown = await aiService.generateWeeklyReport()

      // 2. Форматирование для Telegram (Маркдаун + Чанкование)
      const chunks = TelegramFormatter.prepare(reportMarkdown)

      // 3. Удаляем сообщение "ждите" (по желанию)
      if (waitMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, waitMsgId).catch(() => {})
      }

      // 4. Отправка отчета чанками
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'MarkdownV2' })
      }
    } catch (err: any) {
      logger.error('Ошибка в хендлере отчета', { error: err.message })

      if (waitMsgId) {
        await ctx.api.deleteMessage(ctx.chat.id, waitMsgId).catch(() => {})
      }

      await ctx.reply(`❌ ${err.message || 'Что-то пошло не так при генерации отчета.'}`)
    }
  })

  // Глобальная заглушка на любой другой текст
  bot.on('message:text', async (ctx) => {
    await ctx.reply(
      '👋 Привет! Это тестовый режим, воспользуйтесь кнопкой "Недельный отчет" ниже.',
      {
        reply_markup: mainMenu,
      },
    )
  })

  initQueue()

  startWorkers(bot)

  logger.info('Приложение сконфигурировано с главным меню')

  return bot
}
