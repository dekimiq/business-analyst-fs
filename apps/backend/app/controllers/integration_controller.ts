import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata from '#models/integration_metadata'
import {
  syncStartDateValidator,
  amocrmConfigValidator,
  installTokenValidator,
} from '#validators/integration_validator'
import { YandexApiClient } from '#services/yandex/yandex_api_client'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'

export default class IntegrationController {
  /**
   * @operationId getStatus
   * @tag General
   * @summary Получить статус всех сервисов
   * @description Возвращает массив сервисов с их статусами синхронизации и ошибками.
   * @responseBody 200 - { "result": { "data": { "amocrm": { "status": "string" }, "yandex": { "status": "string" } }, "error": null } }
   */
  public async index({ response }: HttpContext) {
    const integrations = await IntegrationMetadata.all()
    const data: Record<string, any> = {}

    for (const integration of integrations) {
      data[integration.source] = {
        status: integration.syncStatus || 'not_configured',
        lastError: integration.lastError,
      }
    }

    return response.ok({
      result: {
        data,
        error: null,
      },
    })
  }

  /**
   * @operationId setSyncStartDate
   * @tag Sync
   * @summary Установить дату начала синхронизации
   * @description Устанавливает дату для всех сервисов кроме AmoCRM. Выбрасывает ошибку, если дата уже установлена.
   * @requestBody - { "sync_start_date": "2024-01-01" }
   * @responseBody 200 - { "result": { "data": "success", "error": null } }
   * @responseBody 400 - { "result": { "data": null, "error": "date_already_set" } }
   */
  public async setSyncStartDate({ request, response }: HttpContext) {
    const { sync_start_date: syncStartDate } = await request.validateUsing(syncStartDateValidator)

    const integrations = await IntegrationMetadata.query().whereNot('source', 'amocrm')

    for (const integration of integrations) {
      if (integration.syncStartDate) {
        return response.badRequest({
          result: {
            data: null,
            error: `sync_start_date_already_set_for_${integration.source}`,
          },
        })
      }
    }

    await IntegrationMetadata.query().whereNot('source', 'amocrm').update({ syncStartDate })

    return response.ok({
      result: {
        data: 'success',
        error: null,
      },
    })
  }

  /**
   * @operationId setAmocrmConfig
   * @tag AmoCRM
   * @summary Установить конфиг AmoCRM
   * @description Устанавливает domain, client_id и client_secret. Выбрасывает ошибку, если конфиг уже заполнен.
   * @requestBody - { "domain": "example.amo.ru", "client_id": "client_id_here", "client_secret": "client_secret_here" }
   * @responseBody 200 - { "result": { "data": "success", "error": null } }
   */
  public async setAmocrmConfig({ request, response }: HttpContext) {
    const payload = await request.validateUsing(amocrmConfigValidator)

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    const credentials = (amocrm.credentials as any) || {}

    if (credentials?.domain || credentials?.client_id || credentials?.client_secret) {
      return response.badRequest({
        result: {
          data: null,
          error: 'amocrm_config_already_exists',
        },
      })
    }

    amocrm.credentials = { ...credentials, ...payload }
    await amocrm.save()

    return response.ok({
      result: {
        data: 'success',
        error: null,
      },
    })
  }

  /**
   * @operationId installToken
   * @tag General
   * @summary Установить токен (универсальный)
   * @description Проверяет токен (ping) и сохраняет его для указанного сервиса.
   * @requestBody - { "source": "yandex", "token": "token_here" }
   * @responseBody 200 - { "result": { "data": "success", "error": null } }
   */
  public async installToken({ request, response }: HttpContext) {
    const { source, token } = await request.validateUsing(installTokenValidator)

    const integration = await IntegrationMetadata.findByOrFail('source', source)

    let isValid = false
    if (source === 'yandex') {
      const api = new YandexApiClient(token)
      isValid = await api.ping()
    } else if (source === 'amocrm') {
      const credentials = (integration.credentials as any) || {}
      if (!credentials.domain || !credentials.client_id || !credentials.client_secret) {
        return response.badRequest({
          result: {
            data: null,
            error: 'amocrm_config_missing',
          },
        })
      }
      const api = new AmocrmApiClient(token, credentials)
      isValid = await api.ping()
    }

    if (!isValid) {
      return response.badRequest({
        result: {
          data: null,
          error: 'invalid_token',
        },
      })
    }

    const currentCredentials = (integration.credentials as any) || {}
    integration.credentials = { ...currentCredentials, long_token: token }
    await integration.save()

    return response.ok({
      result: {
        data: 'success',
        error: null,
      },
    })
  }

  /**
   * @operationId testNotification
   * @tag General
   * @summary Отправить тестовое уведомление
   * @description Отправляет тестовое уведомление в Telegram-бот через BullMQ.
   * @requestBody - { "module": "test", "message": "Manual test" }
   * @responseBody 200 - { "result": { "data": "enqueued", "error": null } }
   */
  public async testNotification({ request, response }: HttpContext) {
    const { module = 'test-route', message = 'Это тестовое уведомление от бэкенда!' } =
      request.only(['module', 'message'])

    const { NotificationService } = await import('#services/notification_service')
    await NotificationService.getInstance().notifyError(module, message)

    return response.ok({
      result: {
        data: 'enqueued',
        error: null,
      },
    })
  }

  /**
   * @operationId forceSync
   * @tag Sync
   * @summary Принудительный запуск синхронизации
   * @description Ставит задачу в очередь BullMQ с флагом force: true. Игнорирует статус ERROR.
   * @param {string} source - Источник синхронизации (yandex, amocrm)
   * @responseBody 200 - { "result": { "data": "enqueued", "error": null } }
   * @responseBody 404 - { "result": { "data": null, "error": "source_not_found" } }
   */
  public async forceSync({ params, response }: HttpContext) {
    const { source } = params

    const integration = await IntegrationMetadata.findBy('source', source)
    if (!integration) {
      return response.notFound({
        result: {
          data: null,
          error: 'source_not_found',
        },
      })
    }

    const { SyncProducerService } = await import('#services/sync_producer_service')
    await SyncProducerService.getInstance().enqueueSync(source, true)

    return response.ok({
      result: {
        data: 'enqueued',
        error: null,
      },
    })
  }
}
