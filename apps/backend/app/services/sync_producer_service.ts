import { Queue } from 'bullmq'
import { env } from '@project/env'

const SYNC_QUEUE_NAME = 'sync'

/**
 * Сервис-продюсер для очередей синхронизации.
 * Позволяет ставить задачи в очередь 'sync' для выполнения в SyncJob.
 */
export class SyncProducerService {
  private static instance: SyncProducerService | null = null
  private queue: Queue | null = null

  private constructor() {
    this.queue = new Queue(SYNC_QUEUE_NAME, {
      connection: {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        db: env.REDIS_DB_BACKEND,
      },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    })
  }

  public static getInstance(): SyncProducerService {
    if (!SyncProducerService.instance) {
      SyncProducerService.instance = new SyncProducerService()
    }
    return SyncProducerService.instance
  }

  /**
   * Добавляет задачу на синхронизацию в очередь.
   *
   * @param source - Источник ('yandex', 'amocrm')
   * @param force - Принудительный запуск (игнорирует статус ERROR)
   */
  public async enqueueSync(source: string, force: boolean = false): Promise<void> {
    if (!this.queue) return

    await this.queue.add(`${SYNC_QUEUE_NAME}:${source}`, {
      source,
      force,
    })
  }

  /**
   * Добавляет задачу в очередь на очистку старых логов.
   *
   * @param months - Срок хранения в месяцах (по умолчанию 3)
   */
  public async enqueueCleanup(months: number = 3): Promise<void> {
    if (!this.queue) return

    await this.queue.add(`${SYNC_QUEUE_NAME}:cleanup`, {
      months,
    })
  }

  /**
   * Закрытие соединения.
   */
  public async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
  }
}
