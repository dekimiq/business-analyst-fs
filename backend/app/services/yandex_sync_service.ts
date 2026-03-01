import { DateTime } from 'luxon'
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

/**
 * Фатальная ошибка — переводит статус в 'error'.
 * Сигнализирует о неконтролируемой ситуации: API умер, DB недоступна,
 * rate limit не обработался и т.д.
 */
export class YandexFatalError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'YandexFatalError'
  }
}

/**
 * Операция запрещена в текущем статусе синхронизации.
 * Используется контроллером для формирования правильных HTTP-ответов.
 */
export class SyncLockedError extends Error {
  constructor(public readonly status: SyncStatus) {
    super(`Операция недоступна при статусе синхронизации: ${status}`)
    this.name = 'SyncLockedError'
  }
}

/**
 * Синхронизация ещё не завершена — данные неполные.
 * Используется аналитическими эндпоинтами когда запрашивают дату > currentSyncDate.
 */
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

// ---------------------------------------------------------------------------
// Сервис
// ---------------------------------------------------------------------------

export class YandexSyncService {
  constructor(private readonly api: IYandexApiClient) {}

  // -------------------------------------------------------------------------
  // PUBLIC: Статус-гейт — проверка разрешена ли операция
  // -------------------------------------------------------------------------

  /**
   * Проверяет что данные доступны за запрашиваемый диапазон дат.
   * Аналитические эндпоинты вызывают это перед запросом к БД.
   *
   * Выбрасывает:
   *  - SyncLockedError(pending)      → 423 Locked
   *  - SyncPartialDataError(date)    → 206 Partial Content
   *  - SyncLockedError(null)         → 503 Service Unavailable (синк не настроен)
   */
  async assertDataAvailable(requestedDate: DateTime): Promise<void> {
    const meta = await getMeta()

    if (meta.syncStatus === 'pending') {
      throw new SyncLockedError('pending')
    }

    if (!meta.syncStatus || !meta.currentSyncDate) {
      throw new SyncLockedError(null)
    }

    if (requestedDate < meta.currentSyncDate) {
      throw new SyncPartialDataError(meta.currentSyncDate)
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Первичная синхронизация
  // -------------------------------------------------------------------------

  /**
   * Запускает или ВОЗОБНОВЛЯЕТ первичную выгрузку данных из Яндекс.Директ.
   *
   * Разрешено запускать из статусов: null, partial, error
   * Запрещено из: pending (бросает SyncLockedError), success (бросает SyncLockedError)
   *
   * Алгоритм:
   *  1. Если первый запуск (currentSyncDate == null) — грузим структуру (кампании → группы → объявления)
   *     Если resume из partial — структура уже в БД, пропускаем (не тратим API-лимиты)
   *  2. Идём НАЗАД по периодам от startDay до syncStartDate (адаптивные периоды)
   *  3. После каждого успешного периода сохраняем currentSyncDate (resume point)
   *  4. При фатальной ошибке → error + lastError
   *  5. При нефатальной ошибке → partial (можно возобновить с currentSyncDate)
   *  6. При успехе → success
   */
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

    // Запоминаем ДО перехода в pending: есть ли уже прогресс?
    // currentSyncDate !== null → структура уже загружена на предыдущем запуске
    const isResume = meta.currentSyncDate !== null

    meta.syncStatus = 'pending'
    meta.lastError = null
    await meta.save()

    try {
      if (isResume) {
        console.log('[YandexSync] Resume: структурные данные уже загружены, пропускаем.')
      } else {
        await this.syncStructuralData()
      }

      const startDay = meta.currentSyncDate
        ? meta.currentSyncDate.minus({ days: 1 })
        : DateTime.now().minus({ days: 1 }).startOf('day')

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

  /**
   * Подтягивает статистику за вчерашний день.
   *
   * Разрешено из: success, partial, error (manual trigger)
   * Запрещено из: pending (бросает SyncLockedError)
   *
   * Логика при PARTIAL:
   *  1. Сначала синхронизируем вчера (не высаживаем лимиты повтором)
   *  2. Потом продолжаем initialSync (возобновляем с currentSyncDate)
   *
   * Это гарантирует что ежедневные данные всегда актуальны,
   * а initial sync догоняет исторические данные постепенно.
   */
  async dailySync(): Promise<void> {
    const meta = await getMeta()

    if (meta.syncStatus === 'pending') {
      throw new SyncLockedError('pending')
    }

    const yesterday = DateTime.now().minus({ days: 1 }).startOf('day')

    console.log(`[YandexSync] Ежедневная синхронизация за ${yesterday.toISODate()}`)

    try {
      await this.syncDailyStatsForSingleDay(yesterday)
    } catch (error) {
      if (error instanceof YandexAuthError) {
        meta.syncStatus = 'error'
        meta.lastError = `token_error: ${(error as YandexAuthError).message}`
        await meta.save()
        console.error('[YandexSync] ✗ Токен невалиден во время ежедневной синхронизации.')
        throw error
      }
      throw error
    }

    meta.lastSyncAt = DateTime.now()
    await meta.save()

    if (meta.syncStatus === 'partial') {
      console.log('[YandexSync] Статус partial — продолжаем initialSync после ежедневной...')
      await this.initialSync()
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC: Возобновление из error-статуса (ручной триггер)
  // -------------------------------------------------------------------------

  /**
   * Ручное возобновление из статуса error.
   * Переводит error → partial → запускает initialSync.
   * После ежедневного dailySync для актуальности.
   */
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
    console.log('[YandexSync] Синхронизация структурных данных...')

    await db.transaction(async (trx) => {
      // --- Campaigns ---
      const campaigns = await this.api.getCampaigns()
      console.log(`[YandexSync] Получено кампаний: ${campaigns.length}`)

      for (const c of campaigns) {
        await Campaign.updateOrCreate(
          { source: SOURCE, campaignId: c.Id },
          { name: c.Name, type: c.Type ?? null, status: c.Status ?? null, state: c.State ?? null },
          { client: trx }
        )
      }

      // --- AdGroups ---
      const campaignIds = campaigns.map((c) => c.Id)
      const adGroups = await this.api.getAdGroups(campaignIds)
      console.log(`[YandexSync] Получено групп объявлений: ${adGroups.length}`)

      const campaignRecords = await Campaign.query({ client: trx })
        .whereIn('campaign_id', campaignIds)
        .where('source', SOURCE)

      const campaignIdMap = new Map(campaignRecords.map((c) => [c.campaignId, c.id]))

      for (const g of adGroups) {
        const internalCampaignId = campaignIdMap.get(g.CampaignId)
        if (!internalCampaignId) continue

        await AdGroup.updateOrCreate(
          { source: SOURCE, groupId: g.Id },
          { name: g.Name, campaignId: internalCampaignId },
          { client: trx }
        )
      }

      // --- Ads ---
      const adGroupIds = adGroups.map((g) => g.Id)
      const ads = await this.api.getAds(adGroupIds)
      console.log(`[YandexSync] Получено объявлений: ${ads.length}`)

      const adGroupRecords = await AdGroup.query({ client: trx })
        .whereIn('group_id', adGroupIds)
        .where('source', SOURCE)

      const adGroupIdMap = new Map(adGroupRecords.map((g) => [g.groupId, g.id]))

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
    })

    console.log('[YandexSync] Структурные данные синхронизированы.')
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Статистика по дням (адаптивная загрузка по периодам)
  // -------------------------------------------------------------------------

  /**
   * Обходит историю назад от startDay до endDay включительно.
   *
   * Стратегия адаптивных периодов:
   *   - Сначала пробуем загрузить за 30 дней одним запросом
   *   - При YandexRetryExhaustedError (error 152) дробим: 30→14→7→3
   *   - Если 3 дня не пошли — бросаем ошибку (вышестоящий catch → partial)
   *   - Другие ошибки (YandexAuthError, YandexUnknownError) пробрасываем сразу
   *
   * После каждого успешно загруженного периода:
   *   - Сохраняем currentSyncDate = начало периода (resume point)
   *   - Двигаемся к следующему периоду
   */
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

  /**
   * Загружает статистику за диапазон [dateFrom, dateTo] и сохраняет в БД.
   * В отличие от syncDailyStatsForSingleDay — работает с произвольным диапазоном.
   * Конвертирует микроны → рубли (/ 1_000_000).
   */
  private async syncDailyStatsForPeriod(dateFrom: DateTime, dateTo: DateTime): Promise<void> {
    const stats = await this.api.getDailyStats({ dateFrom, dateTo })

    if (stats.length === 0) return

    const yandexAdIds = [...new Set(stats.map((s) => s.AdId))]
    const adRecords = await Ad.query().whereIn('ad_id', yandexAdIds).where('source', SOURCE)
    const adIdMap = new Map(adRecords.map((a) => [a.adId, a.id]))

    await db.transaction(async (trx) => {
      for (const stat of stats) {
        const internalAdId = adIdMap.get(stat.AdId)
        if (!internalAdId) continue

        const statDate = DateTime.fromISO(stat.Date)

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

  /**
   * Запрашивает статистику за один день и сохраняет в БД.
   * Используется dailySync (вчерашний день — всегда 1 день, адаптация не нужна).
   */
  private async syncDailyStatsForSingleDay(day: DateTime): Promise<void> {
    await this.syncDailyStatsForPeriod(day, day)
  }
}
