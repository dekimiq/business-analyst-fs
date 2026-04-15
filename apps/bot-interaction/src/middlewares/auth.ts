import { Context, NextFunction } from 'grammy'
import { UserRepository } from '../database/repositories/userRepository.js'

const userRepository = new UserRepository()

/**
 * Middleware для гибкой авторизации пользователей.
 * 1. Приоритет по user_id (Telegram ID).
 * 2. Если по ID не найден — ищем по username (никнейму).
 * 3. Если найден по нику без ID — активируем (записываем ID).
 */
export async function authMiddleware(ctx: Context, next: NextFunction) {
  const from = ctx.from

  if (!from) {
    return
  }

  const tgId = from.id.toString()
  const username = from.username || ''

  let user = await userRepository.findByUserId(tgId)

  if (user) {
    if (username && user.username !== username) {
      await userRepository.update(user.id, { username })
    }
  } else {
    if (username) {
      const pendingUser = await userRepository.findByUsername(username)

      if (pendingUser && (!pendingUser.user_id || pendingUser.user_id === '')) {
        await userRepository.update(pendingUser.id, {
          user_id: tgId,
          first_name: from.first_name,
          last_name: from.last_name,
        })
        user = pendingUser
      }
    }
  }

  if (!user || !user.is_active) {
    await ctx.reply(`⛔️ Доступ запрещен. Вас нет в базе или ваш аккаунт деактивирован.`)
    return
  }

  // Добавляем данные пользователя в контекст (опционально, если захотим типы расширить)
  // (ctx as any).dbUser = user;

  await next()
}
