import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata, { SyncStatus } from '#models/integration_metadata'

export default class SyncStatusController {
  public async index({ response }: HttpContext) {
    const statuses = await IntegrationMetadata.all()

    const syncingStatuses = [SyncStatus.INITIALIZING, SyncStatus.PENDING, SyncStatus.PARTIAL]
    const isSyncing = statuses.some(
      (status) => status.syncStatus && syncingStatuses.includes(status.syncStatus)
    )

    return response.ok({
      isSyncing,
      statuses,
    })
  }
}
