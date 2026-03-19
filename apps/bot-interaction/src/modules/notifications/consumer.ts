import { Worker } from 'bullmq'
import { createRedisOptions } from '../../config/redis.js'
import { logger } from '../../utils/logger.js'
import { UserRepository } from '../../database/repositories/index.js'
import type { NotificationJobData, NotificationJobResult } from './types.js'
import { templates } from './templates.js'
import { NOTIFICATION_QUEUE_NAME } from './producer.js'
import type { Bot } from 'grammy'
import type { BotContext } from '../../types/index.js'

export function startNotificationConsumer(bot: Bot<BotContext>): Worker {
  const userRepo = new UserRepository()

  const worker = new Worker<NotificationJobData, NotificationJobResult>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const { message, recipientIds, type, payload } = job.data

      logger.info('Обработка задачи уведомления', { jobId: job.id, type })

      let finalMessage = message

      if (payload && type && type !== 'info' && templates[type]) {
        finalMessage = templates[type](payload as any)
      } else if (!finalMessage && payload) {
        finalMessage = `<b>${payload.service} - ${payload.module}:</b>\n${payload.message}`
      }

      if (!finalMessage) {
        throw new Error('Message content is empty')
      }

      let telegramIds: string[]

      if (recipientIds && recipientIds.length > 0) {
        telegramIds = recipientIds
      } else {
        const users = await userRepo.findNotificationRecipients()
        telegramIds = users.map((u) => u.user_id)
      }

      let sentCount = 0
      let failedCount = 0

      for (const telegramId of telegramIds) {
        try {
          await bot.api.sendMessage(telegramId, finalMessage, { parse_mode: 'HTML' })
          sentCount++
        } catch (err) {
          failedCount++
          logger.error('Ошибка отправки уведомления', { telegramId, err })
        }
      }

      logger.info('Задача уведомления выполнена', { отправлено: sentCount, ошибок: failedCount })

      return { sentCount, failedCount }
    },
    {
      connection: createRedisOptions(),
      concurrency: 5,
    },
  )

  worker.on('failed', (job, err) => {
    logger.error('Задача уведомления завершилась с ошибкой', { jobId: job?.id, err })
  })

  return worker
}
