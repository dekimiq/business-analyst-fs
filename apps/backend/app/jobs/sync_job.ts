import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface SyncJobPayload {
  source: string
}

export default class SyncJob {
  private orchestrator = new SyncOrchestratorService()

  /**
   * Job settings to adhere to the rule: "if bullmq task fails, we just drop it and log, no need to keep failed tasks"
   */
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
        `SyncService for source '${payload.source}' is not registered in Orchestrator`
      )
      return
    }

    try {
      await logger.info('Sync job started')
      await service.sync()
      await logger.info('Sync job completed successfully')
    } catch (error) {
      await logger.error(
        `Sync job failed: ${error instanceof Error ? error.message : String(error)}`
      )
      // Not throwing error again since we set removeOnFail: true,
      // but if the BullMQ wrapper needs it to trigger failed event:
      throw error
    }
  }
}
