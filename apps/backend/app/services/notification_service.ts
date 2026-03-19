import { Queue } from 'bullmq'
import { env } from '@project/env'

// Название очереди уведомлений (должно совпадать с очередью в bot-interaction)
const NOTIFICATION_QUEUE_NAME = 'notifications'

/**
 * Сервис для отправки уведомлений в Telegram через BullMQ очередь бота.
 */
export class NotificationService {
  private static instance: NotificationService | null = null
  private queue: Queue | null = null

  private constructor() {
    this.queue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        db: 1,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    })
  }

  /**
   * Получение синглтона сервиса
   */
  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  /**
   * Отправка сообщения об ошибке
   */
  public async notifyError(moduleName: string, message: string): Promise<void> {
    if (!this.queue) return

    await this.queue.add('send', {
      type: 'error',
      payload: {
        service: 'backend',
        module: moduleName,
        message,
      },
    })
  }

  /**
   * Закрытие соединения (для шатдауна)
   */
  public async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
  }
}
