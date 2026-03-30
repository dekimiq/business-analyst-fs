import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import DailyStat from '#models/daily_stat'
import Ad from '#models/ad'
import type { YandexSyncContext } from './yandex_sync_context.ts'
import { YandexRetryService } from '#utils/yandex_retry'
import { ApiReportUnpossible, ApiRetryExhaustedError } from '#exceptions/api_exceptions'

/**
 * Асинхронная историческая загрузка (Offline API Strategy).
 * Выкачивает старые данные кусками (chunk) назад в прошлое.
 * Никогда не блокирует Work'ера долго. Запрашивает отчет в очередь и выходит.
 */
export async function syncHistoricalStats(ctx: YandexSyncContext): Promise<void> {
  const { meta, api, logger, source } = ctx

  if (!meta.syncStartDate) return
  const hardLimit = meta.syncStartDate

  const yesterday = DateTime.now().toUTC().minus({ days: 1 }).startOf('day')
  const currentStart = meta.historicalSyncedUntil
    ? meta.historicalSyncedUntil.minus({ days: 1 })
    : yesterday

  if (currentStart < hardLimit) {
    logger.info(`Историческая синхронизация достигла лимита (${hardLimit.toISODate()}). Готово.`)
    return
  }

  const state = meta.historicalSyncState
  const chunkSizeDays = state?.chunkSize || 30

  if (state && state.status === 'queued') {
    // ---------------------------------------------------------------------------------
    // ВЕТВЬ А: Отчет уже был заказан в прошлый раз. Проверяем его готовность.
    // ---------------------------------------------------------------------------------
    logger.info(
      `[Offline Queue] Проверка готовности отчета: ${state.reportName} за ${state.dateFrom} - ${state.dateTo}`
    )

    const dateFrom = DateTime.fromISO(state.dateFrom)
    const dateTo = DateTime.fromISO(state.dateTo)

    try {
      const stats = await YandexRetryService.call(() =>
        api.getDailyStats({ dateFrom, dateTo, reportName: state.reportName })
      )

      logger.info(`[Offline Queue] Ура! Отчет готов. Получено ${stats.length} строк.`)

      await processAndSaveStats(ctx, stats)

      meta.historicalSyncedUntil = dateFrom
      meta.historicalSyncState = null
      await meta.save()
      logger.info(
        `[Offline Queue] Историческая синхронизация успешно сдвинута в прошлое (до ${dateFrom.toISODate()})`
      )
    } catch (error: any) {
      if (error instanceof ApiRetryExhaustedError) {
        logger.info(
          `[Offline Queue] Яндекс все еще генерирует отчет (202 Accepted). Завершаем Job, подождем следующий запуск.`
        )
        return
      }

      if (error instanceof ApiReportUnpossible) {
        logger.warn(`Отчет оказался слишком тяжелым для Яндекса. Сбрасываем Queue и снижаем окно.`)
        meta.historicalSyncState = {
          status: 'error',
          chunkSize: Math.floor(chunkSizeDays / 2),
        }
        await meta.save()
        return
      }

      throw error
    }
  } else {
    // ---------------------------------------------------------------------------------
    // ВЕТВЬ Б: Нет активного отчета. Заказываем новую порцию.
    // ---------------------------------------------------------------------------------
    let startSpan = currentStart.minus({ days: chunkSizeDays - 1 }).startOf('day')
    if (startSpan < hardLimit) startSpan = hardLimit

    if (chunkSizeDays < 1) {
      logger.error(
        `Невозможно сжать интервал < 1 дня. Яндекс отклоняет все исторические запросы. Остановка.`
      )
      throw new Error('Historical sync failed completely. Chunk size reached 0.')
    }

    const reportName = `hist_queue_${startSpan.toFormat('yyyyMMdd')}_${currentStart.toFormat('yyyyMMdd')}`
    logger.info(
      `[Offline Queue] Заказ нового исторического отчета (${reportName}) на ${chunkSizeDays} дн.`
    )

    try {
      const stats = await YandexRetryService.call(() =>
        api.getDailyStats({ dateFrom: startSpan, dateTo: currentStart, reportName })
      )
      logger.info(`[Offline Queue] Яндекс вернул историю моментально! Сохраняем.`)

      await processAndSaveStats(ctx, stats)

      meta.historicalSyncedUntil = startSpan
      meta.historicalSyncState = null
      await meta.save()
    } catch (error: any) {
      if (error instanceof ApiRetryExhaustedError) {
        meta.historicalSyncState = {
          status: 'queued',
          reportName,
          dateFrom: startSpan.toISODate(),
          dateTo: currentStart.toISODate(),
          chunkSize: chunkSizeDays,
        }
        await meta.save()
        logger.info(
          `Отчет поставлен в оффлайн очередь! Ждем генеарции (проверка запустится в следующем Job).`
        )
      } else if (error instanceof ApiReportUnpossible) {
        logger.warn(`Отчет оказался слишком тяжелым для Яндекса уже при заказе. Снижаем окно.`)
        meta.historicalSyncState = {
          status: 'error',
          chunkSize: Math.floor(chunkSizeDays / 2),
        }
        await meta.save()
      } else {
        throw error
      }
    }
  }
}

/**
 * Обработка и сохранение статистики в БД.
 */
async function processAndSaveStats(ctx: YandexSyncContext, stats: any[]): Promise<void> {
  const { source, logger } = ctx
  if (stats.length === 0) {
    logger.info(`Отчет пуст. Нечего сохранять.`)
    return
  }

  const yandexAdIds = Array.from(new Set(stats.map((s) => String(s.AdId))))
  const adRecords = await Ad.query().whereIn('adId', yandexAdIds).where('source', source)
  const adIdMap = new Map(adRecords.map((a: any) => [String(a.adId), a.id]))

  const payloadToInsert: any[] = []
  for (const stat of stats) {
    const internalAdPk = adIdMap.get(String(stat.AdId))
    if (!internalAdPk) continue

    const statDate = DateTime.fromISO(stat.Date, { zone: 'Europe/Moscow' }).startOf('day')
    payloadToInsert.push({
      adPk: internalAdPk,
      date: statDate,
      impressions: stat.Impressions,
      clicks: stat.Clicks,
      cost: +(stat.Cost / 1_000_000).toFixed(2),
      ctr: stat.Ctr,
      avgCpc: stat.AvgCpc !== null ? +(stat.AvgCpc / 1_000_000).toFixed(2) : null,
      avgCpm: +(stat.AvgCpm / 1_000_000).toFixed(2),
    })
  }

  await db.transaction(async (trx) => {
    for (const data of payloadToInsert) {
      await DailyStat.updateOrCreate({ adPk: data.adPk, date: data.date }, data, {
        client: trx,
      })
    }
  })
}
