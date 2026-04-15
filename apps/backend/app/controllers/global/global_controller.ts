import { type HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import redis from '@adonisjs/redis/services/main'
import IntegrationMetadata from '#models/integration_metadata'
import { ApiResponse } from '#utils/api_response'
import { installTokenValidator } from '#validators/global'

export default class GlobalController {
  /**
   * Получение детального статуса всех сервисов и здоровья системы
   */
  public async getStatus({ response }: HttpContext) {
    const integrations = await IntegrationMetadata.all()
    const services: Record<string, any> = {}

    let dbOk = false
    let redisOk = false

    try {
      await db.rawQuery('SELECT 1')
      dbOk = true
    } catch (e) {}

    try {
      await redis.ping()
      redisOk = true
    } catch (e) {}

    const systemHealth = {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    }

    for (const integration of integrations) {
      const source = integration.source
      const creds = (integration.credentials as any) || {}

      let state = integration.syncStatus || 'ready'

      const hasToken = !!creds.long_token
      const hasId = !!creds.client_id
      const hasSecret = !!creds.client_secret
      const hasDomain = !!creds.domain

      if (!hasToken && !hasId && !hasSecret && !hasDomain) {
        state = 'not_configured'
      } else if (source === 'amocrm' && (!hasId || !hasSecret || !hasDomain)) {
        state = 'not_configured'
      } else if (!hasToken) {
        state = 'pending_token'
      }

      services[source] = {
        state,
        config: {
          hasToken,
          ...(source === 'amocrm'
            ? {
                domain: creds.domain || null,
                hasId,
                hasSecret,
              }
            : {}),
        },
        sync: {
          lastSuccessAt: integration.lastSuccessSyncDate?.toISO() || null,
          syncedUntil: integration.historicalSyncedUntil?.toISODate() || null,
          lastError: integration.lastError,
        },
      }
    }

    return response.ok(
      ApiResponse.ok('Статус системы получен', {
        services,
        system_health: systemHealth,
      })
    )
  }

  /**
   * Установка токена для сервиса (с проверкой пинга)
   */
  public async installToken({ request, response }: HttpContext) {
    const { source, token } = await request.validateUsing(installTokenValidator)

    const integration = await IntegrationMetadata.findByOrFail('source', source)

    let isValid = false
    if (source === 'yandex') {
      const { YandexApiClient } = await import('#services/yandex/api_client')
      const api = new YandexApiClient(token)
      isValid = await api.ping()
    } else if (source === 'amocrm') {
      const { AmocrmApiClient } = await import('#services/amocrm/amocrm_api_client')
      const credentials = (integration.credentials as any) || {}

      if (!credentials.domain || !credentials.client_id || !credentials.client_secret) {
        return response.badRequest(
          ApiResponse.error(
            'Конфигурация AmoCRM не найдена. Сначала настройте домен и ключи через /amocrm/config.'
          )
        )
      }

      const api = new AmocrmApiClient(token, credentials)
      isValid = await api.ping()
    }

    if (!isValid) {
      return response.badRequest(
        ApiResponse.error('Токен не прошел проверку. Убедитесь, что токен не истек и корректен.')
      )
    }

    const currentCredentials = (integration.credentials as any) || {}
    integration.credentials = { ...currentCredentials, long_token: token }
    await integration.save()

    return response.ok(ApiResponse.ok(`Токен для ${source} успешно установлен и проверен`))
  }
}
