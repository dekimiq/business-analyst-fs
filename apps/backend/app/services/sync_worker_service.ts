import { Worker, type Job } from 'bullmq'
import { env } from '@project/env'
import SyncJob from '#jobs/sync_job'
import CleanupLogsJob from '#jobs/cleanup_logs_job'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

/**
 * Сервис-воркер для обработки задач из очереди "sync".
 * Отвечает за:
 * 1. Процессинг синхронизаций (Yandex, AmoCRM).
 * 2. Очистку старых логов.
 */
export class SyncWorkerService {
  private worker: Worker | null = null
  private logger = new SyncLoggerService('worker')

  /**
   * Запускает прослушивание очереди.
   */
  public start() {
    this.worker = new Worker(
      'sync',
      async (job: Job) => {
        await this.logger.info(`Обработка задачи ${job.name} (ID: ${job.id})`)

        if (job.name === 'sync:cleanup') {
          const cleanupJob = new CleanupLogsJob()
          return await cleanupJob.handle(job.data)
        } else if (job.name.startsWith('sync:')) {
          const syncJob = new SyncJob()
          return await syncJob.handle(job.data)
        } else {
          await this.logger.warn(`Неизвестная задача: ${job.name}`)
        }
      },
      {
        connection: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          db: env.REDIS_DB_BACKEND,
        },
        concurrency: 1,
      }
    )

    this.worker.on('failed', async (job: Job | undefined, err: Error) => {
      await this.logger.warn(`Задача ${job?.name} (ID: ${job?.id}) провалена: ${err.message}`)
    })

    this.logger.info('Воркер для очереди "sync" успешно запущен')
  }

  /**
   * Корректно завершает работу воркера (graceful shutdown).
   */
  public async close() {
    if (this.worker) {
      await this.worker.close()
      this.worker = null
      await this.logger.info('Воркер остановлен')
    }
  }
}
