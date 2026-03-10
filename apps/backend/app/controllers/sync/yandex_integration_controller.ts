import { type HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import IntegrationMetadata from '#models/integration_metadata'
import { updateYandexSettingsValidator } from '#validators/sync'

export default class YandexIntegrationController {
  public async updateSettings({ request, response }: HttpContext) {
    const { token, sync_start_date: syncStartDateStr } = await request.validateUsing(
      updateYandexSettingsValidator
    )

    const syncStartDate = syncStartDateStr ? DateTime.fromISO(syncStartDateStr) : undefined

    const metadata = await IntegrationMetadata.updateOrCreate(
      { source: 'yandex' },
      {
        ...(token !== undefined && { token }),
        ...(syncStartDate !== undefined && { syncStartDate }),
      }
    )

    return response.ok(metadata)
  }

  public async status({ response }: HttpContext) {
    const metadata = await IntegrationMetadata.findBy('source', 'yandex')

    if (!metadata) {
      return response.ok({
        isHasToken: false,
        source: 'yandex',
      })
    }

    const { token, ...rest } = metadata.toJSON()

    return response.ok({
      ...rest,
      isHasToken: !!token,
    })
  }
}
