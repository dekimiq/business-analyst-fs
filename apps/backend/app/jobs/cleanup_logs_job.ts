import { Job } from 'adonisjs-jobs'
import SyncLog from '#models/sync_log'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface CleanupJobPayload {
  months?: number
}

/**
 * Job для автоматической очистки старых логов синхронизации.
 * Удаляет записи из таблицы sync_logs старше указанного срока (по умолчанию 3 месяца).
 */
export default class CleanupLogsJob extends Job {
  /**
   * Выполняет очистку логов.
   *
   * @param payload - содержит необязательный параметр months
   */
  async handle(payload: CleanupJobPayload) {
    const months = payload?.months || 3
    const logger = new SyncLoggerService('system:cleanup')

    try {
      await logger.info(`Запущена задача очистки логов (срок хранения: ${months} мес.)`)

      const deletedCount = await SyncLog.pruneOldLogs(months)

      await logger.info(`Очистка завершена. Удалено записей: ${deletedCount}`)
    } catch (error) {
      await logger.error(
        `Ошибка при очистке логов:: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }
}
