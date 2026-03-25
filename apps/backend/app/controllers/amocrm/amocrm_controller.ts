import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata from '#models/integration_metadata'
import { amocrmConfigValidator } from '#validators/amocrm'
import { ApiResponse } from '#utils/api_response'

export default class AmocrmController {
  /**
   * Настройка конфигурации AmoCRM (domain, client_id, client_secret)
   */
  public async setConfig({ request, response }: HttpContext) {
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
    const { domain, client_id, client_secret } = payload

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

    const amocrm = await IntegrationMetadata.updateOrCreate(
      { source: 'amocrm' },
      {
        credentials: {
          domain,
          client_id,
          client_secret,
        },
      }
    )

    return response.ok(
      ApiResponse.ok('Конфигурация AmoCRM успешно установлена', {
        domain: amocrm.credentials?.domain,
      })
    )
  }
}
