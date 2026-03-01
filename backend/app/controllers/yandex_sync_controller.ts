import type { HttpContext } from '@adonisjs/core/http'
import queue from '@acidiney/bull-queue/services/main'
import IntegrationMetadata from '#models/integration_metadata'
import { SyncLockedError } from '#services/yandex_sync_service'
import type { YandexSyncJobPayload } from '#jobs/yandex_sync_job'

function locked(response: HttpContext['response'], body: object) {
  return response.status(423).send(body)
}

export default class YandexSyncController {
  // -------------------------------------------------------------------------
  // GET /api/sync/yandex/status
  // -------------------------------------------------------------------------

  /**
   * @summary Статус синхронизации
   * @description Доступен при любом статусе. Возвращает syncStatus, даты и последнюю ошибку.
   * @tag Sync
   * @responseBody 200 - {"syncStatus": "string", "syncStartDate": "string", "currentSyncDate": "string", "lastSyncAt": "string", "lastError": "string"}
   */
  async getStatus({ response }: HttpContext) {
    const meta = await IntegrationMetadata.findBy('source', 'yandex')

    let errorContext: 'token_error' | 'daily_error' | 'initial_error' | null = null

    if (meta?.syncStatus === 'error') {
      if (meta.lastError?.startsWith('token_error:')) {
        errorContext = 'token_error'
      } else if (
        meta.currentSyncDate &&
        meta.syncStartDate &&
        meta.currentSyncDate.toISODate() === meta.syncStartDate.toISODate()
      ) {
        errorContext = 'daily_error'
      } else {
        errorContext = 'initial_error'
      }
    }

    return response.ok({
      syncStatus: meta?.syncStatus ?? null,
      syncStartDate: meta?.syncStartDate?.toISODate() ?? null,
      currentSyncDate: meta?.currentSyncDate?.toISODate() ?? null,
      lastSyncAt: meta?.lastSyncAt?.toISO() ?? null,
      lastError: meta?.lastError ?? null,
      errorContext,
    })
  }

  // -------------------------------------------------------------------------
  // POST /api/sync/yandex/initial
  // -------------------------------------------------------------------------

  /**
   * @summary Запустить первичную синхронизацию
   * @description Разрешено только из статуса null (самый первый запуск).
   *   Из partial/error используйте /continuation. Требует настроенной sync_start_date.
   * @tag Sync
   * @responseBody 202 - {"message": "string", "jobId": "string"}
   * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string", "message": "string"}
   * @responseBody 409 - {"error": "string", "syncStatus": "string", "message": "string"}
   */
  async triggerInitialSync({ response }: HttpContext) {
    const meta = await IntegrationMetadata.findBy('source', 'yandex')
    const status = meta?.syncStatus ?? null

    if (status === 'pending') {
      return locked(response, {
        error: 'sync_locked',
        message: 'Синхронизация уже выполняется. Дождитесь завершения.',
        syncStatus: status,
      })
    }

    if (status !== null) {
      return response.conflict({
        error: 'initial_not_allowed',
        message:
          status === 'partial' || status === 'error'
            ? `Первичный запуск недоступен при статусе "${status}". Используйте POST /api/sync/yandex/continuation.`
            : 'Первичная синхронизация уже завершена.',
        syncStatus: status,
      })
    }

    if (!meta?.syncStartDate) {
      return response.unprocessableEntity({
        error: 'sync_date_not_configured',
        message: 'Установите дату начала: POST /api/yandex/settings/sync-date',
      })
    }

    const job = await queue.dispatch('yandex_sync_job', { type: 'initial' } as YandexSyncJobPayload)
    return response.accepted({
      message: 'Первичная синхронизация поставлена в очередь.',
      jobId: job.id,
    })
  }

  // -------------------------------------------------------------------------
  // POST /api/sync/yandex/daily
  // -------------------------------------------------------------------------

  /**
   * @summary Ежедневная синхронизация (ручной триггер)
   * @description Разрешено из: success, partial.
   *   При partial — сначала вчера, потом продолжает initial sync.
   * @tag Sync
   * @responseBody 202 - {"message": "string", "jobId": "string"}
   * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string"}
   * @responseBody 409 - {"error": "string", "syncStatus": "string"}
   */
  async triggerDailySync({ response }: HttpContext) {
    const meta = await IntegrationMetadata.findBy('source', 'yandex')
    const status = meta?.syncStatus ?? null

    if (status === 'pending') {
      return locked(response, {
        error: 'sync_locked',
        message: 'Синхронизация уже выполняется.',
        syncStatus: status,
      })
    }

    if (status !== 'success' && status !== 'partial') {
      return response.conflict({
        error: 'daily_not_allowed',
        message:
          status === 'error'
            ? 'При статусе error используйте POST /api/sync/yandex/continuation.'
            : 'Сначала выполните первичную синхронизацию.',
        syncStatus: status,
      })
    }

    const job = await queue.dispatch('yandex_sync_job', { type: 'daily' } as YandexSyncJobPayload)
    return response.accepted({
      message: 'Ежедневная синхронизация поставлена в очередь.',
      jobId: job.id,
    })
  }

  // -------------------------------------------------------------------------
  // POST /api/sync/yandex/continuation
  // -------------------------------------------------------------------------

  /**
   * @summary Умный запуск / возобновление синхронизации
   * @description Работает из любого статуса кроме pending и success:
   *   - null    → запускает initial (первый старт, требует настроенной sync_start_date)
   *   - partial → daily + продолжает initial
   *   - error   → daily + возобновляет initial
   * @tag Sync
   * @responseBody 202 - {"message": "string", "jobId": "string"}
   * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string"}
   * @responseBody 409 - {"error": "string", "syncStatus": "string"}
   */
  async triggerContinuation({ response }: HttpContext) {
    const meta = await IntegrationMetadata.findBy('source', 'yandex')
    const status = meta?.syncStatus ?? null

    if (status === 'pending') {
      return locked(response, {
        error: 'sync_locked',
        message: 'Синхронизация уже выполняется.',
        syncStatus: status,
      })
    }

    if (status === 'success') {
      return response.conflict({
        error: 'continuation_not_allowed',
        message:
          'Синхронизация уже завершена. Для ежедневного обновления используйте POST /api/sync/yandex/daily.',
        syncStatus: status,
      })
    }

    // null     → initial      (первый запуск)
    // partial  → daily        (сервис сам вызовет initialSync после ежедневки)
    // error    → continuation (сервис сбрасывает error→partial, затем daily→initial)
    let jobType: YandexSyncJobPayload['type']
    let message: string

    if (status === null) {
      jobType = 'initial'
      message = 'Первичная синхронизация поставлена в очередь.'
    } else if (status === 'partial') {
      jobType = 'daily'
      message = 'Продолжение первичной синхронизации поставлено в очередь.'
    } else {
      // status === 'error'
      jobType = 'continuation'
      message = 'Возобновление из error-статуса поставлено в очередь.'
    }

    const job = await queue.dispatch('yandex_sync_job', { type: jobType } as YandexSyncJobPayload)
    return response.accepted({ message, jobId: job.id })
  }
}

// ---------------------------------------------------------------------------
// Хелпер для аналитических эндпоинтов
// ---------------------------------------------------------------------------

/**
 * Обрабатывает SyncLockedError в аналитических контроллерах.
 * Импортируй и вызывай в catch-блоке при assertDataAvailable.
 *
 *  SyncLockedError(pending) → 423 Locked
 *  SyncLockedError(null)    → 503 Service Unavailable
 */
export function handleSyncError(error: unknown, response: HttpContext['response']): void {
  if (error instanceof SyncLockedError) {
    if (error.status === 'pending') {
      response.status(423).send({
        error: 'sync_locked',
        message: 'Данные временно недоступны — идёт синхронизация.',
        syncStatus: error.status,
      })
      return
    }
    response.serviceUnavailable({
      error: 'sync_not_configured',
      message: 'Синхронизация данных ещё не была запущена.',
    })
    return
  }
  throw error
}
