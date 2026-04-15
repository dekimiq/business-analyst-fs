import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata from '#models/integration_metadata'
import { amocrmConfigValidator } from '#validators/amocrm'
import { ApiResponse } from '#utils/api_response'
import { env } from '@project/env'
import axios from 'axios'

export default class AmocrmController {
  /**
   * Установка конфигурации AmoCRM и обмен кода на токены
   */
  public async setup({ request, response }: HttpContext) {
    // 1. Предварительная нормализация (до основной валидации)
    let rawDomain = request.input('domain') || ''

    // Удаляем протоколы
    rawDomain = rawDomain.replace(/^https?:\/\//i, '')
    // Оставляем только доменную часть (удаляем пути)
    rawDomain = rawDomain.split('/')[0].split('?')[0]

    // Подменяем в запросе нормализованный домен для валидатора
    request.updateBody({ ...request.all(), domain: rawDomain })

    // 2. Валидация базовых правил (длина, формат)
    const payload = await request.validateUsing(amocrmConfigValidator)
    const { domain, code } = payload

    /**
     * 3. ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА (Окно возможностей)
     * Если нужно разрешить кастомные домены, установите STRICT_DOMAIN_CHECK = false
     */
    const STRICT_DOMAIN_CHECK = true
    if (STRICT_DOMAIN_CHECK) {
      if (!domain.toLowerCase().endsWith('.amocrm.ru')) {
        return response.badRequest(ApiResponse.error('Домен должен принадлежать зоне .amocrm.ru'))
      }
    }

    try {
      const client_id = env.AMOCRM_CLIENT_ID
      const client_secret = env.AMOCRM_CLIENT_SECRET

      if (!client_id || !client_secret) {
        return response.internalServerError(
          ApiResponse.error('Внутренняя ошибка сервера: не заданы глобальные ключи AmoCRM')
        )
      }

      // Прямо в процессе настройки обмениваем access код на access и refresh токены
      const tokenResponse = await axios.post(`https://${domain}/oauth2/access_token`, {
        client_id,
        client_secret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `https://${env.HUB_DOMAIN}/api/callbacks/amocrm`,
      })

      const newAccessToken = tokenResponse.data.access_token
      const newRefreshToken = tokenResponse.data.refresh_token

      const amocrm = await IntegrationMetadata.updateOrCreate(
        { source: 'amocrm' },
        {
          credentials: {
            domain,
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
          },
        }
      )

      return response.ok(
        ApiResponse.ok('Конфигурация AmoCRM успешно установлена и токены получены', {
          domain: amocrm.credentials?.domain,
        })
      )
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || error.message || 'Неизвестная ошибка'
      return response.badRequest(
        ApiResponse.error(`Ошибка при получении токенов от AmoCRM: ${errorMessage}`)
      )
    }
  }
}
