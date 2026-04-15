import IntegrationMetadata from '#models/integration_metadata'
import type { IAmocrmApiClient } from '#contracts/i_amocrm_api_client'
import type { SyncLoggerService } from '#services/sync/sync_logger_service'

export interface AmocrmSyncContext {
  source: string
  api: IAmocrmApiClient
  logger: SyncLoggerService
  meta: IntegrationMetadata
  force: boolean
  mode: 'light' | 'heavy'
}
