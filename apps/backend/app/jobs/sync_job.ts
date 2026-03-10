import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface SyncJobPayload {
  source: string
}

export default class SyncJob {
  private orchestrator = new SyncOrchestratorService()
  static get options() {
    return {
      removeOnFail: true,
      removeOnComplete: true,
      attempts: 1,
    }
  }

  async handle(payload: SyncJobPayload) {
    const logger = new SyncLoggerService(payload.source)
    const service = this.orchestrator.getService(payload.source)

    if (!service) {
      await logger.error(
        `SyncService для источника '${payload.source}' не зарегистрирован в Orchestrator`
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
