import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import DailyStat from '#models/daily_stat'
import Ad from '#models/ad'
import type { YandexSyncContext } from './yandex_sync_context.js'

/**
 * Загрузка ежедневной статистики.
 *
 * Логика выбора интервала (приоритет):
 *  1. meta.historicalSyncState.statBorderDate — выставляется incremental_sync при STAT-изменениях.
 *     Если есть, качаем с этой даты (может быть глубоко в прошлом).
 *  2. Стандартный "хвост" в 3 дня (актуальная подгрузка при отсутствии корректировок).
 *
 * Все данные скачиваются без DB-транзакций. Транзакция открывается только для быстрой вставки.
 */
export async function syncDailyStats(ctx: YandexSyncContext): Promise<void> {
  const { meta, api, logger, source } = ctx

  const yesterday = DateTime.now().toUTC().minus({ days: 1 }).startOf('day')
  const dateTo = yesterday

  // Определяем dateFrom по приоритету
  const statBorderDate: string | undefined = (meta.historicalSyncState as any)?.statBorderDate
  let dateFrom: DateTime

  if (statBorderDate) {
    dateFrom = DateTime.fromISO(statBorderDate).toUTC().startOf('day')
    logger.info(
      `[DailyStats] STAT-корректировка обнаружена. Интервал: ${dateFrom.toISODate()} → ${dateTo.toISODate()}`
    )
  } else {
    dateFrom = DateTime.now().toUTC().minus({ days: 3 }).startOf('day')
    logger.info(`[DailyStats] Стандартный хвост: ${dateFrom.toISODate()} → ${dateTo.toISODate()}`)
  }

  // Дата не может быть позже вчерашнего
  if (dateFrom > dateTo) {
    dateFrom = dateTo
  }

  // HTTP запрос — вне транзакции (Fixes DB Lock Starvation)
  const stats = await api.getDailyStats({ dateFrom, dateTo })
  logger.info(`[DailyStats] Получено ${stats.length} строк из Яндекса.`)

  if (stats.length > 0) {
    await persistStats(ctx, stats)
  }

  // Сбрасываем statBorderDate — данные скачаны
  if (statBorderDate) {
    const state = (meta.historicalSyncState as any) ?? {}
    delete state.statBorderDate
    meta.historicalSyncState = Object.keys(state).length > 0 ? state : null
    await meta.save()
    logger.info('[DailyStats] statBorderDate сброшен.')
  }

  meta.lastSuccessSyncDate = yesterday
  await meta.save()
  logger.info(`[DailyStats] Завершено. Сохранено строк: ${stats.length}`)
}

// ---------------------------------------------------------------------------
// Вставка статистики в БД (пакетно, один проход)
// ---------------------------------------------------------------------------

async function persistStats(
  ctx: YandexSyncContext,
  stats: Awaited<ReturnType<typeof ctx.api.getDailyStats>>
): Promise<void> {
  const { source, logger } = ctx

  // Один SELECT для всех AdId — без N+1
  const yandexAdIds = Array.from(new Set(stats.map((s) => String(s.AdId))))
  const adRecords = await Ad.query().whereIn('adId', yandexAdIds).where('source', source)
  const adIdMap = new Map(adRecords.map((a) => [String(a.adId), a.id]))

  const payload = stats
    .map((stat) => {
      const internalAdPk = adIdMap.get(String(stat.AdId))
      if (!internalAdPk) return null

      return {
        adPk: internalAdPk,
        date: DateTime.fromISO(stat.Date, { zone: 'Europe/Moscow' }).startOf('day'),
        impressions: stat.Impressions,
        clicks: stat.Clicks,
        cost: +(stat.Cost / 1_000_000).toFixed(2),
        ctr: stat.Ctr,
        avgCpc: stat.AvgCpc !== null ? +(stat.AvgCpc / 1_000_000).toFixed(2) : null,
        avgCpm: +(stat.AvgCpm / 1_000_000).toFixed(2),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (payload.length === 0) {
    logger.warn('[DailyStats] Нет строк для вставки — возможно, AdId не найдены в БД.')
    return
  }

  // Одна транзакция для всего пакета
  await db.transaction(async (trx) => {
    for (const data of payload) {
      await DailyStat.updateOrCreate({ adPk: data.adPk, date: data.date }, data, {
        client: trx,
      })
    }
  })

  logger.info(
    `[DailyStats] Вставлено/обновлено ${payload.length} записей (${stats.length - payload.length} пропущено — нет adId в БД).`
  )
}
