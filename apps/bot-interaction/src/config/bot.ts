import { Bot } from 'grammy'
import { env } from '@project/env'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { BotContext } from '../types/index.js'

// Создание экземпляра Grammy бота
export function createBot(): Bot<BotContext> {
  const token = env.TELEGRAM_BOT_TOKEN

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в .env')
  }

  // Настройка прокси для работы в WSL за v2rayN
  const proxyUrl = process.env.https_proxy || process.env.http_proxy

  if (proxyUrl) {
    console.log(`🔌 Используем прокси: ${proxyUrl}`)
  }

  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined

  return new Bot<BotContext>(token, {
    client: {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    },
  })
}
