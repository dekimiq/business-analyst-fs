import type { JobHandlerContract, Job } from '@acidiney/bull-queue/types'
import env from '#start/env'
import { YandexSyncService } from '#services/yandex_sync_service'
import YandexApiClientService from '#services/yandex_api_client_service'
import YandexApiClientMock from '#services/yandex_api_client_mock'
import IntegrationMetadata from '#models/integration_metadata'

// ---------------------------------------------------------------------------
// Типы payload
// ---------------------------------------------------------------------------

export type YandexSyncJobPayload = {
  type: 'initial' | 'daily' | 'continuation'
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/**
 * BullMQ-джоб для синхронизации данных Яндекс.Директ.
 *
 * Типы запуска:
 *  - initial      — первичная синхронизация (или resume из partial)
 *  - daily        — ежедневная (cron, 03:00 UTC+3). При partial сначала daily → потом continuation
 *  - continuation — явное возобновление из статуса error
 *
 * Retry намеренно НЕ используется: YandexSyncService сам управляет resume
 * через currentSyncDate. BullMQ-ретрай запустил бы всё с нуля.
 */
export default class YandexSyncJob implements JobHandlerContract<YandexSyncJobPayload> {
  public async handle(job: Job<YandexSyncJobPayload>): Promise<void> {
    const apiClient = await this.makeApiClient()
    const service = new YandexSyncService(apiClient)

    console.log(`[YandexSyncJob] Запуск: type=${job.data.type}, mock=${env.get('YANDEX_USE_MOCK')}`)

    switch (job.data.type) {
      case 'initial':
        await service.initialSync()
        break

      case 'daily':
        await service.dailySync()
        break

      case 'continuation':
        await service.continueFromError()
        break
    }
  }

  /**
   * Вызывается BullMQ когда джоб упал и исчерпал все попытки.
   *
   * Критично: если сервер был убит (SIGKILL) пока джоб выполнялся,
   * syncStatus застрянет в 'pending'. Здесь мы переводим его в 'partial'
   * чтобы разблокировать систему и позволить cron/ручному триггеру продолжить.
   *
   * Если YandexSyncService уже поставил 'error' — не перезаписываем.
   */
  public async failed(_job: Job<YandexSyncJobPayload>): Promise<void> {
    console.error(`[YandexSyncJob] Джоб провалился: type=${_job.data.type}. Проверяем статус...`)

    try {
      const meta = await IntegrationMetadata.findBy('source', 'yandex')

      if (meta?.syncStatus === 'pending') {
        // Застрял в pending — значит process был убит без catch
        // Переводим в partial чтобы cron мог возобновить
        meta.syncStatus = 'partial'
        meta.lastError = `Джоб прерван внешне (${_job.data.type}). Причина: ${_job.failedReason ?? 'неизвестна'}`
        await meta.save()
        console.warn('[YandexSyncJob] pending → partial (process was killed externally)')
      }
    } catch (dbError) {
      // Если даже БД не доступна — только логируем
      console.error('[YandexSyncJob] Не удалось обновить статус в БД:', dbError)
    }
  }

  // ---------------------------------------------------------------------------
  // Фабрика API-клиента
  // ---------------------------------------------------------------------------

  private async makeApiClient(): Promise<YandexApiClientMock | YandexApiClientService> {
    if (env.get('YANDEX_USE_MOCK')) {
      return new YandexApiClientMock()
    }

    const meta = await IntegrationMetadata.findBy('source', 'yandex')

    if (!meta?.token) {
      throw new Error('Yandex API token не настроен. Используйте POST /api/yandex/settings/token')
    }

    return new YandexApiClientService(meta.token)
  }
}
