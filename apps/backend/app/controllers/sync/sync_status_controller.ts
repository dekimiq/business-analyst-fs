import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata, { SyncStatus } from '#models/integration_metadata'

export default class SyncStatusController {
  /**
   * @index
   * @operationId getGlobalStatus
   * @tag Global
   * @summary Общий статус
   * @responseBody 200 - {"isSyncing": false}
   */
  public async index({ response }: HttpContext) {
    const statuses = await IntegrationMetadata.all()

    const syncingStatuses = [SyncStatus.PARTIAL]
    const isSyncing = statuses.some(
      (status) => status.syncStatus && syncingStatuses.includes(status.syncStatus)
    )

    return response.ok({
      isSyncing,
      statuses,
    })
  }
}
