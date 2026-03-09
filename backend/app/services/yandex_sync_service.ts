import { DateTime } from 'luxon'
import { getNow, getYesterday } from '#utils/yandex_dates'
import db from '@adonisjs/lucid/services/db'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import DailyStat from '#models/daily_stat'
import IntegrationMetadata from '#models/integration_metadata'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import { YandexAuthError } from '#utils/yandex_retry'

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const SOURCE = 'yandex'
const PERIOD_STEPS_DAYS = [30, 14, 7, 3] as const

export type SyncStatus = 'pending' | 'partial' | 'success' | 'error' | null

// ---------------------------------------------------------------------------
// Кастомные ошибки
// ---------------------------------------------------------------------------

export class YandexFatalError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'YandexFatalError'
  }
}

export class SyncLockedError extends Error {
  constructor(public readonly status: SyncStatus) {
    super(`Операция недоступна при статусе синхронизации: ${status}`)
    this.name = 'SyncLockedError'
  }
}

export class SyncPartialDataError extends Error {
  constructor(public readonly availableUntil: DateTime) {
    super(`Данные доступны только до ${availableUntil.toISODate()} (синхронизация не завершена).`)
    this.name = 'SyncPartialDataError'
  }
}

// ---------------------------------------------------------------------------
// Хелпер для получения/создания мета-записи
// ---------------------------------------------------------------------------

async function getMeta(): Promise<IntegrationMetadata> {
  return IntegrationMetadata.firstOrCreate(
    { source: SOURCE },
    {
      token: null,
      lastTimestamp: null,
      syncStartDate: null,
      currentSyncDate: null,
      lastSyncAt: null,
      syncStatus: null,
      lastError: null,
    }
  )
}

export type DataAvailability = {
  availableUntil: DateTime | null
}

// ---------------------------------------------------------------------------
// Сервис
// ---------------------------------------------------------------------------

export class YandexSyncService {
  constructor(private readonly api: IYandexApiClient) {}

  // -------------------------------------------------------------------------
  // PUBLIC: Проверка доступности данных (для аналитических эндпоинтов)
  // -------------------------------------------------------------------------

  async checkDataAvailability(): Promise<DataAvailability> {
    const meta = await getMeta()

    if (meta.syncStatus === 'pending') {
      throw new SyncLockedError('pending')
    }

    if (!meta.syncStatus || !meta.currentSyncDate) {
      throw new SyncLockedError(null)
    }

    if (meta.syncStatus !== 'success') {
      return { availableUntil: meta.currentSyncDate }
    }

    return { availableUntil: null }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Первичная синхронизация
  // -------------------------------------------------------------------------

  async initialSync(): Promise<void> {
    const meta = await getMeta()

    if (meta.syncStatus === 'pending') {
      throw new SyncLockedError('pending')
    }
    if (meta.syncStatus === 'success') {
      throw new SyncLockedError('success')
    }

    if (!meta.syncStartDate) {
      throw new YandexFatalError(
        'sync_start_date не настроен. Вызовите POST /api/yandex/settings/sync-date перед запуском синхронизации.'
      )
    }

    const isResume = meta.currentSyncDate !== null

    meta.syncStatus = 'pending'
    meta.lastError = null
    await meta.save()

    try {
      if (meta.lastTimestamp === null) {
        console.log('[YandexSync] Получаем стартовый Timestamp для отслеживания изменений...')
        meta.lastTimestamp = await this.api.getServerTimestamp()
        await meta.save()
        console.log(`[YandexSync] Стартовый Timestamp сохранён: ${meta.lastTimestamp}`)
      }

      if (isResume) {
        console.log('[YandexSync] Resume: структурные данные уже загружены, пропускаем.')
      } else {
        await this.syncStructuralData()
      }

      const startDay = meta.currentSyncDate
        ? meta.currentSyncDate.minus({ days: 1 })
        : getYesterday()

      const endDay = meta.syncStartDate

      await this.syncDailyStatsBackwards(startDay, endDay, meta)

      meta.syncStatus = 'success'
      meta.lastSyncAt = DateTime.now()
      await meta.save()

      console.log(`[YandexSync] ✓ Первичная синхронизация завершена (${SOURCE})`)
    } catch (error) {
      if (error instanceof YandexAuthError) {
        meta.syncStatus = 'error'
        meta.lastError = `token_error: ${error.message}`
        await meta.save()
        console.error(
          '[YandexSync] ✗ Токен невалиден или истёк. Обновите токен через POST /api/yandex/settings/token'
        )
      } else if (error instanceof YandexFatalError) {
        meta.syncStatus = 'error'
        meta.lastError = error.message
        await meta.save()
        console.error(`[YandexSync] ✗ ФАТАЛЬНАЯ ошибка: ${error.message}`)
      } else {
        meta.syncStatus = 'partial'
        meta.lastError = error instanceof Error ? error.message : String(error)
        await meta.save()
        console.warn(
          `[YandexSync] ⚠ Синхронизация прервана, статус: partial. Причина: ${meta.lastError}`
        )
      }
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Ежедневная синхронизация
  // -------------------------------------------------------------------------

  async dailySync(): Promise<void> {
    const meta = await getMeta()

    if (meta.syncStatus === 'pending') {
      throw new SyncLockedError('pending')
    }

    const lastTimestamp = meta.lastTimestamp || (await this.api.getServerTimestamp())
    console.log(`[YandexSync] Ежедневная синхронизация. Проверка изменений с: ${lastTimestamp}`)

    let newTimestamp: string
    let borderDateStr: string | undefined

    try {
      const campaignRecords = await Campaign.query().where('source', SOURCE)
      const campaignIds = campaignRecords.map((c) => Number(c.campaignId))

      const changes = await this.api.checkChanges(lastTimestamp, campaignIds)
      newTimestamp = changes.Timestamp

      if (changes.CampaignsStat && changes.CampaignsStat.length > 0) {
        const borderDates = changes.CampaignsStat.map((c) => c.BorderDate).filter(
          (d): d is string => !!d
        )

        if (borderDates.length > 0) {
          borderDates.sort()
          borderDateStr = borderDates[0]
        }
      }
    } catch (error) {
      if (error instanceof YandexAuthError) {
        meta.syncStatus = 'error'
        meta.lastError = `token_error: ${(error as YandexAuthError).message}`
        await meta.save()
        console.error('[YandexSync] ✗ Токен невалиден во время проверки изменений.')
      }
      throw error
    }

    const yesterday = getYesterday()
    let dateFrom: DateTime
    const dateTo: DateTime = yesterday

    if (borderDateStr) {
      dateFrom = DateTime.fromISO(borderDateStr, { zone: 'Europe/Moscow' }).startOf('day')
      console.log(
        `[YandexSync] Найдены изменения (BorderDate: ${borderDateStr}). Загрузка периода ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    } else {
      dateFrom = getNow().minus({ days: 3 }).startOf('day')
      console.log(
        `[YandexSync] Изменений нет (BorderDate нет). Упреждающая загрузка периода ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    }

    if (dateFrom > dateTo) {
      dateFrom = dateTo
    }

    try {
      await this.syncDailyStatsForPeriodUpsert(dateFrom, dateTo)
      meta.lastTimestamp = newTimestamp
      meta.lastSyncAt = getNow()
      await meta.save()
      console.log(
        `[YandexSync] Ежедневная синхронизация успешно завершена. Новый Timestamp сохранено: ${newTimestamp}`
      )
    } catch (error) {
      console.error('[YandexSync] ✗ Ошибка во время загрузки статистики.')
      throw error
    }

    if (meta.syncStatus === 'partial') {
      console.log('[YandexSync] Статус partial — продолжаем initialSync после ежедневной...')
      await this.initialSync()
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Возобновление из error-статуса (ручной триггер)
  // -------------------------------------------------------------------------

  async continueFromError(): Promise<void> {
    const meta = await getMeta()

    if (meta.syncStatus !== 'error') {
      throw new SyncLockedError(meta.syncStatus)
    }

    meta.syncStatus = 'partial'
    meta.lastError = null
    await meta.save()

    await this.dailySync()
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Структурные данные
  // -------------------------------------------------------------------------

  private async syncStructuralData(): Promise<void> {
    console.log('[YandexSync] Синхронизация структурных данных (с отслеживанием прогресса)...')
    const meta = await getMeta()

    let phase = meta.structuralSyncPhase || 'campaigns'

    // --- Campaigns ---
    if (phase === 'campaigns') {
      await db.transaction(async (trx) => {
        const campaigns = await this.api.getCampaigns()
        console.log(`[YandexSync] Получено кампаний: ${campaigns.length}`)

        for (const c of campaigns) {
          await Campaign.updateOrCreate(
            { source: SOURCE, campaignId: c.Id },
            {
              name: c.Name,
              type: c.Type ?? null,
              status: c.Status ?? null,
              state: c.State ?? null,
            },
            { client: trx }
          )
        }
      })
      meta.structuralSyncPhase = 'adGroups'
      await meta.save()
      phase = 'adGroups'
    }

    // --- AdGroups ---
    if (phase === 'adGroups') {
      await db.transaction(async (trx) => {
        const campaignRecords = await Campaign.query({ client: trx }).where('source', SOURCE)
        const campaignIds = campaignRecords.map((c) => Number(c.campaignId))

        if (campaignIds.length > 0) {
          const adGroups = await this.api.getAdGroups(campaignIds)
          console.log(`[YandexSync] Получено групп объявлений: ${adGroups.length}`)

          const campaignIdMap = new Map(campaignRecords.map((c) => [Number(c.campaignId), c.id]))

          for (const g of adGroups) {
            const internalCampaignId = campaignIdMap.get(g.CampaignId)
            if (!internalCampaignId) continue

            await AdGroup.updateOrCreate(
              { source: SOURCE, groupId: g.Id },
              { name: g.Name, campaignId: internalCampaignId },
              { client: trx }
            )
          }
        } else {
          console.log(`[YandexSync] Нет кампаний для загрузки групп объявлений.`)
        }
      })
      meta.structuralSyncPhase = 'ads'
      await meta.save()
      phase = 'ads'
    }

    // --- Ads ---
    if (phase === 'ads') {
      await db.transaction(async (trx) => {
        const adGroupRecords = await AdGroup.query({ client: trx }).where('source', SOURCE)
        const adGroupIds = adGroupRecords.map((g) => Number(g.groupId))

        if (adGroupIds.length > 0) {
          const ads = await this.api.getAds(adGroupIds)
          console.log(`[YandexSync] Получено объявлений: ${ads.length}`)

          const adGroupIdMap = new Map(adGroupRecords.map((g) => [Number(g.groupId), g.id]))

          for (const a of ads) {
            const internalGroupId = adGroupIdMap.get(a.AdGroupId)
            if (!internalGroupId) continue

            await Ad.updateOrCreate(
              { source: SOURCE, adId: a.Id },
              {
                groupId: internalGroupId,
                title: a.TextAd?.Title ?? null,
                text: a.TextAd?.Text ?? null,
              },
              { client: trx }
            )
          }
        } else {
          console.log(`[YandexSync] Нет групп для загрузки объявлений.`)
        }
      })
      meta.structuralSyncPhase = 'done'
      await meta.save()
      phase = 'done'
    }

    console.log('[YandexSync] Структурные данные успешно синхронизированы.')
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Статистика по дням (адаптивная загрузка по периодам)
  // -------------------------------------------------------------------------

  private async syncDailyStatsBackwards(
    startDay: DateTime,
    endDay: DateTime,
    meta: IntegrationMetadata
  ): Promise<void> {
    let periodEnd = startDay

    while (periodEnd >= endDay) {
      await this.syncPeriodAdaptive(periodEnd, endDay, meta)
      periodEnd = meta.currentSyncDate!.minus({ days: 1 })
    }
  }

  /**
   * Загружает один период от periodEnd назад с адаптивным дроблением.
   *
   * @param periodEnd   — правый край (включительно)
   * @param hardLimit   — левая граница всей синхронизации (syncStartDate)
   * @param meta        — для сохранения currentSyncDate после каждого успеха
   */
  private async syncPeriodAdaptive(
    periodEnd: DateTime,
    hardLimit: DateTime,
    meta: IntegrationMetadata
  ): Promise<void> {
    const { YandexRetryExhaustedError } = await import('#utils/yandex_retry')

    for (const stepDays of PERIOD_STEPS_DAYS) {
      const rawStart = periodEnd.minus({ days: stepDays - 1 }).startOf('day')
      const periodStart = rawStart < hardLimit ? hardLimit : rawStart

      console.log(
        `[YandexSync] Пробуем период ${periodStart.toISODate()} – ${periodEnd.toISODate()} (${stepDays} дн.)`
      )

      try {
        await this.syncDailyStatsForPeriod(periodStart, periodEnd)
        meta.currentSyncDate = periodStart
        await meta.save()

        console.log(
          `[YandexSync] ✓ Период загружен: ${periodStart.toISODate()} – ${periodEnd.toISODate()}`
        )
        return
      } catch (error) {
        if (error instanceof YandexRetryExhaustedError) {
          if (stepDays === PERIOD_STEPS_DAYS[PERIOD_STEPS_DAYS.length - 1]) {
            console.warn(
              `[YandexSync] ⚠ Минимальный период (${stepDays} дн.) не прошёл — ждём следующей выгрузки. ` +
                `Прогресс сохранён до ${meta.currentSyncDate?.toISODate() ?? 'начала'}`
            )
            throw error
          }
          console.warn(
            `[YandexSync] ⚠ Период ${stepDays} дн. — error 152, дробим до следующего шага...`
          )
          continue
        }

        throw error
      }
    }
  }

  private async syncDailyStatsForPeriod(dateFrom: DateTime, dateTo: DateTime): Promise<void> {
    const stats = await this.api.getDailyStats({ dateFrom, dateTo })

    if (stats.length === 0) return

    const yandexAdIds = [...new Set(stats.map((s) => s.AdId))]
    const adRecords = await Ad.query().whereIn('ad_id', yandexAdIds).where('source', SOURCE)
    const adIdMap = new Map(adRecords.map((a) => [Number(a.adId), a.id]))

    await db.transaction(async (trx) => {
      for (const stat of stats) {
        const internalAdId = adIdMap.get(stat.AdId)
        if (!internalAdId) continue

        const statDate = DateTime.fromISO(stat.Date, { zone: 'Europe/Moscow' }).startOf('day')

        await DailyStat.updateOrCreate(
          { adId: internalAdId, date: statDate },
          {
            impressions: stat.Impressions,
            clicks: stat.Clicks,
            cost: +(stat.Cost / 1_000_000).toFixed(2),
            ctr: stat.Ctr,
            avgCpc: stat.AvgCpc !== null ? +(stat.AvgCpc / 1_000_000).toFixed(2) : null,
            avgCpm: +(stat.AvgCpm / 1_000_000).toFixed(2),
          },
          { client: trx }
        )
      }
    })
  }

  private async syncDailyStatsForPeriodUpsert(dateFrom: DateTime, dateTo: DateTime): Promise<void> {
    await this.syncDailyStatsForPeriod(dateFrom, dateTo)
  }
}
