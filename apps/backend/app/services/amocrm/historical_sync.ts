import type { AmocrmSyncContext } from './amocrm_sync_context.js'
import { saveLeadsToDb } from './save_leads.js'
import { DateTime } from 'luxon'
import { ApiRetryExhaustedError, ApiFatalError } from '#exceptions/api_exceptions'

/**
 * Адаптивная историческая синхронизация (Yandex-style).
 * Опрашивает сделки кусками, умеет сжимать окно при ошибках (Timeout/Too Large).
 */
export async function historicalSync(ctx: AmocrmSyncContext): Promise<void> {
  const { meta, api, logger } = ctx

  const hardLimit = meta.syncStartDate || DateTime.now().minus({ months: 1 })
  const syncEndDate = DateTime.now()

  let currentStart = meta.historicalSyncedUntil || hardLimit

  if (currentStart >= syncEndDate) {
    logger.info(
      `[AmoCRM] [Historical] Синхронизация уже заверешена (достигнуто ${syncEndDate.toISODate()})`
    )
    return
  }

  const state = meta.historicalSyncState || {}
  const chunkSizeDays = state.chunkSize || 30

  let currentEnd = currentStart.plus({ days: chunkSizeDays })
  if (currentEnd > syncEndDate) {
    currentEnd = syncEndDate
  }

  const fromTs = Math.floor(currentStart.toSeconds())
  const toTs = Math.floor(currentEnd.toSeconds())

  logger.info(
    `[AmoCRM] [Historical] Запрос интервала: ${currentStart.toISODate()} - ${currentEnd.toISODate()} (Окно: ${chunkSizeDays} дн.)`
  )

  try {
    let intervalCount = 0

    await api.eachLead({ updatedAt: { from: fromTs, to: toTs } }, async (leads) => {
      if (leads.length > 0) {
        await saveLeadsToDb(ctx, leads)

        const lastLead = leads[leads.length - 1]
        meta.lastTimestamp = String(lastLead.updated_at)

        intervalCount += leads.length
      }
    })

    logger.info(`[AmoCRM] [Historical] Интервал успешно загружен. Получено: ${intervalCount}`)

    meta.historicalSyncedUntil = currentEnd
    await meta.save()
  } catch (error: any) {
    const errorMsg = (error.message || '').toLowerCase()

    const isTimeout = error instanceof ApiRetryExhaustedError
    const isTooLarge =
      (error instanceof ApiFatalError && (error.status === 400 || error.status === 504)) ||
      errorMsg.includes('too large') ||
      errorMsg.includes('too complex') ||
      errorMsg.includes('gateway timeout')

    if (isTimeout || isTooLarge) {
      if (chunkSizeDays <= 1) {
        logger.error(
          `[AmoCRM] [Historical] Окно уже минимально (1 день), но запрос всё равно падает. Требуется ручное вмешательство.`
        )
        throw error
      }

      const newChunkSize = Math.floor(chunkSizeDays / 2)
      logger.warn(
        `[AmoCRM] [Historical] Запрос оказался слишком тяжелым или долгим. Сжимаем окно: ${chunkSizeDays} -> ${newChunkSize} дней.`
      )

      meta.historicalSyncState = {
        ...state,
        chunkSize: newChunkSize,
        lastError: error.message,
      }
      await meta.save()

      return
    }
    throw error
  }
}
