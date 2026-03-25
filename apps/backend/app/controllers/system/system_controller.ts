import { type HttpContext } from '@adonisjs/core/http'
import IntegrationMetadata from '#models/integration_metadata'
import { ApiResponse } from '#utils/api_response'
import { syncStartDateValidator } from '#validators/system'

export default class SystemController {
  /**
   * Установка глобальной даты начала синхронизации (кроме AmoCRM)
   */
  public async setSyncStartDate({ request, response }: HttpContext) {
    const { sync_start_date: syncStartDate } = await request.validateUsing(syncStartDateValidator)

    const integrations = await IntegrationMetadata.all()

    for (const integration of integrations) {
      if (integration.source !== 'amocrm' && integration.syncStartDate) {
        return response.badRequest(
          ApiResponse.error(`Дата начала синхронизации уже установлена для ${integration.source}`)
        )
      }
    }

    await IntegrationMetadata.query().whereNot('source', 'amocrm').update({ syncStartDate })

    return response.ok(ApiResponse.ok('Глобальная дата начала синхронизации установлена'))
  }

  /**
   * Принудительный запуск синхронизации (через очередь BullMQ)
   */
  public async forceSync({ params, response }: HttpContext) {
    const { source } = params

    const integration = await IntegrationMetadata.findBy('source', source)
    if (!integration) {
      return response.notFound(ApiResponse.error(`Источник '${source}' не найден`))
    }

    const { SyncProducerService } = await import('#services/sync_producer_service')
    await SyncProducerService.getInstance().enqueueSync(source, true)

    return response.ok(
      ApiResponse.ok(`Синхронизация для ${source} поставлена в очередь (force mode)`)
    )
  }

  /**
   * Тестовое уведомление в Telegram (для проверки работы уведомлений)
   */
  public async testNotification({ request, response }: HttpContext) {
    const { module = 'test-system', message = 'Системное тестовое сообщение!' } = request.only([
      'module',
      'message',
    ])

    const { NotificationService } = await import('#services/notification_service')
    await NotificationService.getInstance().notifyError(module, message)

    return response.ok(ApiResponse.ok('Тестовое уведомление поставлено в очередь'))
  }
}
