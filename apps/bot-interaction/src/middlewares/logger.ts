import type { NextFunction } from 'grammy'
import { logger } from '../utils/logger.js'
import type { BotContext } from '../types/index.js'

export async function loggerMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const from = ctx.from?.id ?? 'неизвестный'
  const text = ctx.message?.text ?? ctx.callbackQuery?.data ?? '-'
  const updateType = Object.keys(ctx.update).find((k) => k !== 'update_id') ?? 'unknown'

  logger.info('Входящий апдейт', { userId: from, тип: updateType, текст: text })

  await next()
}
