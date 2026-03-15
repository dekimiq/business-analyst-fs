import { type HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import IntegrationMetadata, { SyncStatus } from '#models/integration_metadata'
import { setupYandexSettingsValidator, updateYandexTokenValidator } from '#validators/sync'
import { YandexApiClient } from '#services/yandex/yandex_api_client'
import { YandexSyncService } from '#services/sync/yandex_sync_service'

/**
 * Контроллер для управления интеграцией Yandex Direct.
 * Предоставляет endpoints для настройки токена, даты начала синхронизации и запуска синхронизации.
 */
export default class YandexIntegrationController {
  /**
   * @setupSettings
   * @operationId setupSettings
   * @tag Yandex
   * @summary Первичная настройка Яндекса
   * @description Установка токена и даты начала синхронизации.
   * @requestBody {"token": "string", "sync_start_date": "string"}
   * @responseBody 200 - {"status": "success", "message": "saved"}
   */
  public async setupSettings({ request, response }: HttpContext) {
    const existing = await IntegrationMetadata.findBy('source', 'yandex')

    if (existing?.token || existing?.syncStartDate) {
      return response.badRequest({
        status: 'error',
        error: 'settings_already_exist',
        message:
          'Настройки уже установлены. Изменение даты начала синхронизации невозможно, а для обновления токена используйте специальный маршрут /token.',
      })
    }

    const payload = await request.validateUsing(setupYandexSettingsValidator)
    const { token, sync_start_date: syncStartDateStr } = payload

    const api = new YandexApiClient(token)
    const isValid = await api.ping()

    if (!isValid) {
      return response.badRequest({
        status: 'error',
        error: 'invalid_token',
        message: 'Токен невалидный или истёк. Проверьте токен и попробуйте снова.',
      })
    }

    const syncStartDate = DateTime.fromISO(syncStartDateStr)

    const metadata = await IntegrationMetadata.updateOrCreate(
      { source: 'yandex' },
      {
        token,
        syncStartDate,
      }
    )

    return response.ok({
      status: 'success',
      message: 'Настройки успешно установлены',
      hasToken: !!metadata.token,
      syncStartDate: metadata.syncStartDate?.toISODate(),
      syncStatus: metadata.syncStatus,
    })
  }

  /**
   * @updateToken
   * @operationId updateToken
   * @tag Yandex
   * @summary Обновить токен Яндекса
   * @requestBody {"token": "string"}
   * @responseBody 200 - {"status": "success", "message": "saved"}
   */
  public async updateToken({ request, response }: HttpContext) {
    const { token } = await request.validateUsing(updateYandexTokenValidator)

    const api = new YandexApiClient(token)
    const isValid = await api.ping()

    if (!isValid) {
      return response.badRequest({
        status: 'error',
        error: 'invalid_token',
        message: 'Токен невалидный или истёк. Проверьте токен и попробуйте снова.',
      })
    }

    const metadata = await IntegrationMetadata.updateOrCreate({ source: 'yandex' }, { token })

    return response.ok({
      status: 'success',
      message: 'Токен сохранён и проверен',
      hasToken: !!metadata.token,
    })
  }

  /**
   * @status
   * @operationId getStatus
   * @tag Yandex
   * @summary Статус интеграции Яндекс
   * @responseBody 200 - {"status": "success", "isHasToken": true}
   */
  public async status({ response }: HttpContext) {
    const metadata = await IntegrationMetadata.findBy('source', 'yandex')

    if (!metadata) {
      return response.ok({
        status: 'success',
        isHasToken: false,
        lastTimestamp: null,
        syncStartDate: null,
        syncedUntil: null,
        lastSuccessSyncDate: null,
        syncStatus: null,
        referenceSyncPhase: null,
        lastError: null,
      })
    }

    return response.ok({
      status: 'success',
      isHasToken: !!metadata.token,
      lastTimestamp: metadata.lastTimestamp,
      syncStartDate: metadata.syncStartDate?.toISODate() ?? null,
      syncedUntil: metadata.syncedUntil?.toISODate() ?? null,
      lastSuccessSyncDate: metadata.lastSuccessSyncDate?.toISODate() ?? null,
      referenceSyncPhase: metadata.referenceSyncPhase,
      lastError: metadata.lastError,
    })
  }

  /**
   * @sync
   * @operationId triggerSync
   * @tag Yandex
   * @summary Запустить синхронизацию
   * @responseBody 200 - {"status": "success", "message": "completed"}
   */
  public async sync({ response }: HttpContext) {
    const metadata = await IntegrationMetadata.findBy('source', 'yandex')

    if (!metadata || !metadata.token) {
      return response.badRequest({
        status: 'error',
        error: 'settings_missing',
        message: 'Невозможно запустить синхронизацию: токен или настройки не установлены.',
      })
    }

    if (!metadata.syncStartDate) {
      return response.badRequest({
        status: 'error',
        error: 'sync_start_date_missing',
        message: 'Невозможно запустить синхронизацию: не указана дата начала синхронизации.',
      })
    }

    const api = new YandexApiClient(metadata.token)
    const syncService = new YandexSyncService(api)

    try {
      await syncService.sync()

      return response.ok({
        status: 'success',
        message: 'Синхронизация завершена',
        syncStatus: metadata.syncStatus,
      })
    } catch (error) {
      return response.badRequest({
        status: 'error',
        error: 'sync_failed',
        message: error instanceof Error ? error.message : 'Ошибка при синхронизации',
      })
    }
  }
}
