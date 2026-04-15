import type { AmocrmSyncContext } from './amocrm_sync_context.js'
import { saveLeadsToDb } from './save_leads.js'
import { DateTime } from 'luxon'
import { ApiRetryExhaustedError, ApiFatalError } from '#exceptions/api_exceptions'

/**
 * Адаптивная историческая синхронизация (Yandex-style).
 * Идет ОБРАТНО во времени: от текущего момента (или точки остановки) до syncStartDate.
 */
export async function historicalSync(ctx: AmocrmSyncContext): Promise<void> {
  const { meta, api, logger } = ctx

  const hardLimit = meta.syncStartDate // Мы не должны заходить раньше этой даты
  if (!hardLimit) {
    logger.error(`[AmoCRM] [Historical] syncStartDate не задана. Синхронизация невозможна.`)
    return
  }

  // Точка, ОТ которой мы идем назад.
  // Если еще не начинали - стартуем от "сегодня".
  let currentEnd = meta.historicalSyncedUntil || DateTime.now()

  // Если мы уже дошли до лимита или перешагнули его - выходим.
  if (currentEnd <= hardLimit) {
    logger.info(
      `[AmoCRM] [Historical] Историческая синхронизация уже завершена (достигнут лимит ${hardLimit.toISODate()})`
    )
    return
  }

  const state = meta.historicalSyncState || {}
  const chunkSizeDays = state.chunkSize || 30

  // Вычисляем окно: идем назад на chunkSizeDays
  let currentStart = currentEnd.minus({ days: chunkSizeDays })

  // Не проваливаемся ниже лимита
  if (currentStart < hardLimit) {
    currentStart = hardLimit
  }

  const fromTs = Math.floor(currentStart.toSeconds())
  const toTs = Math.floor(currentEnd.toSeconds())

  logger.info(
    `[AmoCRM] [Historical] Запрос интервала (назад): ${currentStart.toISODate()} - ${currentEnd.toISODate()} (Окно: ${chunkSizeDays} дн.)`
  )

  try {
    let intervalCount = 0

    // Используем updatedAt для полной сверки за период
    await api.eachLead({ updatedAt: { from: fromTs, to: toTs } }, async (leads) => {
      if (leads.length > 0) {
        await saveLeadsToDb(ctx, leads)
        intervalCount += leads.length
      }
    })

    logger.info(`[AmoCRM] [Historical] Интервал успешно загружен. Получено: ${intervalCount}`)

    // Сдвигаем точку окончания для следующего запуска
    meta.historicalSyncedUntil = currentStart

    // Если достигли лимита - помечаем успех в стейте
    if (currentStart <= hardLimit) {
      logger.info(`[AmoCRM] [Historical] Финиш. Достигнута дата начала: ${hardLimit.toISODate()}`)
    }

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
          `[AmoCRM] [Historical] Окно уже минимально (1 день), но запрос всё равно падает.`
        )
        throw error
      }

      const newChunkSize = Math.floor(chunkSizeDays / 2)
      logger.warn(
        `[AmoCRM] [Historical] Запрос слишком тяжелый. Сжимаем окно до ${newChunkSize} дней.`
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
