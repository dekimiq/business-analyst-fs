import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import {
  YandexSettingsService,
  InvalidTokenError,
  InvalidDateError,
  DateAlreadySetError,
} from '#services/yandex_settings_service'
import { syncDateValidator, tokenValidator } from '#validators/yandex_settings_validator'
import YandexApiClientService from '#services/yandex_api_client_service'
import YandexApiClientMock from '#services/yandex_api_client_mock'
import type { IYandexApiClient } from '../contracts/i_yandex_api_client.js'

export default class YandexSettingsController {
  // ---------------------------------------------------------------------------
  // GET /api/yandex/settings
  // ---------------------------------------------------------------------------

  /**
   * @summary Текущие настройки Яндекс.Директ
   * @description Возвращает: наличие токена, дату начала синхронизации и статус первичной синхронизации.
   * @tag Yandex
   * @responseBody 200 - {"hasToken": "boolean", "syncStartDate": "string", "syncStatus": "string"}
   */
  async getSettings({ response }: HttpContext) {
    const service = this.makeSettingsService(new YandexApiClientMock())
    const settings = await service.getSettings()
    return response.ok(settings)
  }

  // ---------------------------------------------------------------------------
  // POST /api/yandex/settings/sync-date
  // ---------------------------------------------------------------------------

  /**
   * @summary Установить дату начала синхронизации
   * @description Устанавливает `sync_start_date`. Два варианта:
   *   - `{"useDefault": true}` — today minus 3 months (рекомендуется)
   *   - `{"date": "2025-06-01"}` — конкретный ISO-день YYYY-MM-DD
   *   Если `syncStatus` был `success` — сбрасывается, позволяя перезапустить с новой даты.
   * @tag Yandex
   * @requestBody {"useDefault": true, "date": "2025-01-01"}
   * @responseBody 200 - {"syncStartDate": "string", "message": "string"}
   * @responseBody 422 - {"error": "string", "message": "string"}
   */
  async setSyncDate({ request, response }: HttpContext) {
    const payload = await request.validateUsing(syncDateValidator)

    if (!payload.useDefault && !payload.date) {
      return response.unprocessableEntity({
        error: 'validation_error',
        message: 'Неверный параметр. Укажите дату или примените значение по умолчанию.',
      })
    }

    const service = this.makeSettingsService(new YandexApiClientMock())

    try {
      const syncStartDate = await service.setSyncStartDate({
        useDefault: payload.useDefault,
        date: payload.date,
      })

      return response.ok({
        syncStartDate: syncStartDate.toISODate(),
        message: 'Дата точки синхронизации установлена.',
      })
    } catch (error) {
      if (error instanceof DateAlreadySetError) {
        return response.conflict({
          error: 'date_already_set',
          message: error.message,
        })
      }
      if (error instanceof InvalidDateError) {
        return response.unprocessableEntity({
          error: 'invalid_date',
          message: error.message,
        })
      }
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/yandex/settings/token
  // ---------------------------------------------------------------------------

  /**
   * @summary Сохранить OAuth 2.0 токен Яндекс.Директ
   * @description Принимает токен, делает пинг к Яндекс.Директ API для проверки,
   *   затем сохраняет в зашифрованном виде (AES-256 через AdonisJS encryption).
   *   В dev-режиме (YANDEX_USE_MOCK=true) пинг всегда успешен — можно сохранить любую строку.
   * @tag Yandex
   * @requestBody {"token": "y0_AgAAAAA_your_token_here"}
   * @responseBody 200 - {"message": "string"}
   * @responseBody 422 - {"error": "string", "message": "string"}
   */
  async saveToken({ request, response }: HttpContext) {
    const payload = await request.validateUsing(tokenValidator)

    const apiClient: IYandexApiClient = env.get('YANDEX_USE_MOCK')
      ? new YandexApiClientMock()
      : new YandexApiClientService(payload.token)

    const service = this.makeSettingsService(apiClient)

    try {
      await service.saveToken(payload.token)
      return response.ok({ message: 'Токен успешно сохранён.' })
    } catch (error) {
      console.log(error)
      if (error instanceof InvalidTokenError) {
        return response.unprocessableEntity({
          error: 'invalid_token',
          message: error.message,
        })
      }
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Фабрика сервиса
  // ---------------------------------------------------------------------------

  private makeSettingsService(apiClient: IYandexApiClient): YandexSettingsService {
    return new YandexSettingsService(apiClient)
  }
}
