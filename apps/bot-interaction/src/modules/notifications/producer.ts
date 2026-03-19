import { Queue } from 'bullmq'
import { createRedisOptions } from '../../config/redis.js'
import { logger } from '../../utils/logger.js'
import type { NotificationJobData } from './types.js'

// Название очереди уведомлений
export const NOTIFICATION_QUEUE_NAME = 'notifications'

// Очередь уведомлений (синглтон)
let queue: Queue<NotificationJobData> | null = null

export function getNotificationQueue(): Queue<NotificationJobData> {
  if (!queue) {
    queue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE_NAME, {
      connection: createRedisOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    })
  }
  return queue
}

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  const q = getNotificationQueue()
  await q.add('send', data)
  logger.info('Уведомление добавлено в очередь', { сообщение: data.message.slice(0, 50) })
}
