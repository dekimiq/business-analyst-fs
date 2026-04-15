import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import { type SyncLoggerService } from '#services/sync/sync_logger_service'
import type IntegrationMetadata from '#models/integration_metadata'

export interface YandexSyncContext {
  source: string
  api: IYandexApiClient
  logger: SyncLoggerService
  meta: IntegrationMetadata
  force: boolean
}
