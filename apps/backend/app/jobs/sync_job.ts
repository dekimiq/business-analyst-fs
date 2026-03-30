import { Job } from 'adonisjs-jobs'
import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface SyncJobPayload {
  source: string
  force?: boolean
  mode?: 'light' | 'heavy'
}

/**
 * Job синхронизации данных из внешних источников.
 *
 * Использует DI для получения сервисов из IoC-контейнера.
 * Orchestrator создаёт sync-сервисы динамически на основе токена из IntegrationMetadata.
 */
export default class SyncJob extends Job {
  /**
   * Обрабатывает задачу синхронизации для указанного источника.
   *
   * @param payload - содержит source ('yandex', 'amocrm', etc) и необязательный force
   */
  async handle(payload: SyncJobPayload) {
    // Получаем сервисы из IoC-контейнера
    const orchestrator = await SyncOrchestratorService.init()
    const logger = new SyncLoggerService(payload.source)

    const service = await orchestrator.getService(payload.source)

    if (!service) {
      await logger.warn(
        `SyncService для источника '${payload.source}' не зарегистрирован или недоступен (нет токена)`
      )
      return
    }

    try {
      await logger.info(
        `Запущена задача синхронизации (force: ${!!payload.force}, mode: ${payload.mode || 'default'})`
      )
      await service.sync(!!payload.force, payload.mode)
      await logger.info('Задача синхронизации успешно завершена')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Ошибки ожидания справочников или отсутствия токена — это WARN
      if (
        message.toLowerCase().includes('таймауту') ||
        message.toLowerCase().includes('token') ||
        message.toLowerCase().includes('метаданных') ||
        message.toLowerCase().includes('credentials')
      ) {
        await logger.warn(`Задача синхронизации приостановлена (ожидание): ${message}`)
        return
      }

      await logger.warn(`Ошибка выполнения задачи синхронизации:: ${message}`)
      throw error
    }
  }
}
