import IntegrationMetadata from '#models/integration_metadata'
import { YandexSyncServiceFacade as YandexSyncService } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import { AmocrmSyncServiceFacade as AmocrmSyncService } from '#services/amocrm/index'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import type { ISyncService } from '#contracts/i_sync_service'
import type { SyncLoggerService } from '#services/sync/sync_logger_service'
import { env } from '@project/env'

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

    const credentials = meta.credentials || {}
    const token = (credentials as any).access_token || (credentials as any).long_token
    if (!token) {
      await this.logger.warn(`SyncServiceFactory: токен для источника '${source}' не установлен`)
      return null
    }

    switch (source) {
      case 'yandex': {
        const apiClient = new YandexApiClient(token)
        return new YandexSyncService(apiClient)
      }

      case 'amocrm': {
        const amocrmConfig = {
          domain: (credentials as any).domain,
          client_id: env.AMOCRM_CLIENT_ID as string,
          client_secret: env.AMOCRM_CLIENT_SECRET as string,
          refresh_token: (credentials as any).refresh_token,
          onTokenRefresh: async (newTokens: { access_token: string; refresh_token: string }) => {
            const currentMeta = await IntegrationMetadata.findByOrFail({ source })
            const currentCreds = currentMeta.credentials || {}
            currentMeta.credentials = {
              ...currentCreds,
              access_token: newTokens.access_token,
              refresh_token: newTokens.refresh_token,
            }
            await currentMeta.save()
            await this.logger.info(
              `SyncServiceFactory: токены AmoCRM успешно обновлены и сохранены в БД`
            )
          },
        }

        const apiClient = new AmocrmApiClient(token, amocrmConfig)
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
