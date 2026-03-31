import SyncJob from '#jobs/sync_job'
import CleanupLogsJob from '#jobs/cleanup_logs_job'

/**
 * Сервис-продюсер для очередей синхронизации.
 * Позволяет ставить задачи в очередь через adonisjs-jobs.
 */
export class SyncProducerService {
  private static instance: SyncProducerService | null = null

  private constructor() {}

  public static getInstance(): SyncProducerService {
    if (!SyncProducerService.instance) {
      SyncProducerService.instance = new SyncProducerService()
    }
    return SyncProducerService.instance
  }

  public async enqueueSync(
    source: string,
    force: boolean = false,
    mode?: 'light' | 'heavy'
  ): Promise<void> {
    if (source === 'ads') {
      const { default: IntegrationMetadata } = await import('#models/integration_metadata')
      const sources = await IntegrationMetadata.query()
        .whereNot('source', 'amocrm')
        .select('source')

      for (const meta of sources) {
        await SyncJob.dispatch({
          source: meta.source,
          force,
          mode,
        })
      }
      return
    }

    await SyncJob.dispatch({
      source,
      force,
      mode,
    })
  }

  /**
   * Добавляет задачу в очередь на очистку старых логов.
   *
   * @param months - Срок хранения в месяцах (по умолчанию 3)
   */
  public async enqueueCleanup(months: number = 3): Promise<void> {
    await CleanupLogsJob.dispatch({
      months,
    })
  }

  /**
   * Закрытие соединения. (No-op)
   */
  public async close(): Promise<void> {}
}
