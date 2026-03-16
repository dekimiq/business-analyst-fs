import IntegrationMetadata from '#models/integration_metadata'
import { YandexSyncService } from '#services/sync/yandex_sync_service'
import { YandexApiClient } from '#services/yandex/yandex_api_client'
import { AmocrmSyncService } from '#services/sync/amocrm_sync_service'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import type { ISyncService } from '#contracts/i_sync_service'
import type { SyncLoggerService } from '#services/sync/sync_logger_service'

/**
 * Фабрика для создания sync-сервисов с токеном из IntegrationMetadata.
 *
 * При добавлении нового источника:
 * 1. Добавьте case в метод createService()
 * 2. Реализуйте соответствующий API-клиент
 * 3. Оберните его в ваш sync-сервис
 */
export class SyncServiceFactory {
  constructor(private readonly logger: SyncLoggerService) {}

  /**
   * Создаёт sync-сервис для указанного источника на основе метаданных из БД.
   *
   * @param source - источник ('yandex', 'amocrm', ...)
   * @returns экземпляр ISyncService или null, если источник неизвестен
   */
  async createService(source: string): Promise<ISyncService | null> {
    const meta = await IntegrationMetadata.findByOrFail({ source })

    if (!meta.token) {
      await this.logger.warn(`SyncServiceFactory: токен для источника '${source}' не установлен`)
      return null
    }

    switch (source) {
      case 'yandex': {
        const apiClient = new YandexApiClient(meta.token)
        return new YandexSyncService(apiClient)
      }

      case 'amocrm': {
        const apiClient = new AmocrmApiClient(meta.token, meta.config || {})
        return new AmocrmSyncService(apiClient)
      }

      default:
        await this.logger.warn(`SyncServiceFactory: неизвестный источник '${source}'`)
        return null
    }
  }

  /**
   * Возвращает список всех доступных источников синхронизации.
   */
  static getAvailableSources(): string[] {
    return ['yandex', 'amocrm']
  }
}
