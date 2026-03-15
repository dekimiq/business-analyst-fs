import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface SyncJobPayload {
  source: string
}

/**
 * Job синхронизации данных из внешних источников.
 *
 * Использует DI для получения сервисов из IoC-контейнера.
 * Orchestrator создаёт sync-сервисы динамически на основе токена из IntegrationMetadata.
 */
export default class SyncJob {
  static get options() {
    return {
      removeOnFail: true,
      removeOnComplete: true,
      attempts: 1,
    }
  }

  /**
   * Обрабатывает задачу синхронизации для указанного источника.
   *
   * @param payload - содержит source ('yandex', 'amocrm', etc)
   */
  async handle(payload: SyncJobPayload) {
    // Получаем сервисы из IoC-контейнера
    const orchestrator = await SyncOrchestratorService.init()
    const logger = new SyncLoggerService(payload.source)

    // Получаем сервис синхронизации для указанного источника
    const service = await orchestrator.getService(payload.source)

    if (!service) {
      await logger.error(
        `SyncService для источника '${payload.source}' не зарегистрирован или недоступен (нет токена)`
      )
      return
    }

    try {
      await logger.info('Запущена задача синхронизации')
      await service.sync()
      await logger.info('Задача синхронизации успешно завершена')
    } catch (error) {
      await logger.error(
        `Ошибка выполнения задачи синхронизации:: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }
}
