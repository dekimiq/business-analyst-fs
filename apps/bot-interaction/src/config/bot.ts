import { Bot } from 'grammy'
import { env } from '@project/env'
import type { BotContext } from '../types/index.js'

// Создание экземпляра Grammy бота
export function createBot(): Bot<BotContext> {
  const token = env.TELEGRAM_BOT_TOKEN

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в .env')
  }

  return new Bot<BotContext>(token)
}
