import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import DailyStat from '#models/daily_stat'
import IntegrationMetadata, { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiReportUnpossible,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'
import {
  MetaSyncStartDateUnavailableError,
  MetaTokenUnavailableError,
  SyncError,
} from '#exceptions/sync_exceptions'
import { YandexRetryService } from '#utils/yandex_retry'
import type { ISyncService } from '#contracts/i_sync_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'
import { yesterdayUtc, daysAgoUtc } from '#utils/date_utils'

const SOURCE = 'yandex'
const PERIOD_STEPS_DAYS = [30, 14, 7] as const

export class YandexSyncService implements ISyncService {
  public readonly source = SOURCE
  private readonly logger: SyncLoggerService

  constructor(private readonly api: IYandexApiClient) {
    this.logger = new SyncLoggerService(SOURCE)
  }

  // -------------------------------------------------------------------------
  // PUBLIC: ISyncService Implementation
  // -------------------------------------------------------------------------
  async sync(force: boolean = false): Promise<void> {
    const meta = await this.getMeta()

    if (!force && meta.syncStatus === SyncStatus.ERROR) {
      this.logger.warn(
        `Синхронизация пропущена: сервис '${SOURCE}' находится в статусе ERROR. Ожидание вмешательства разработчика.`
      )
      return
    }

    if (force && meta.syncStatus === SyncStatus.ERROR) {
      this.logger.info(`Принудительный запуск синхронизации для '${SOURCE}' из состояния ERROR`)
    }

    this.logger.info(`Синхронизация запущена. Текущий статус: ${meta.syncStatus}`)

    try {
      if (!meta.credentials?.long_token) {
        throw new MetaTokenUnavailableError()
      }

      if (!meta.syncStartDate) {
        throw new MetaSyncStartDateUnavailableError()
      }

      const isInitialSync = meta.syncStatus === null

      const isResuming =
        meta.syncStatus === SyncStatus.PARTIAL ||
        (force &&
          meta.syncStatus === SyncStatus.ERROR &&
          meta.referenceSyncPhase !== ReferenceSyncPhase.DONE)

      if (isInitialSync || isResuming) {
        if (isResuming) {
          this.logger.info(`Возобновление синхронизации из состояния: ${meta.syncStatus}`)
        }

        // --- Structural Data (Timestamp, Campaigns, AdGroups, Ads) ---
        if (meta.referenceSyncPhase !== ReferenceSyncPhase.DONE) {
          await this.syncStructuralData(meta)
        }

        const startDay = meta.syncedUntil ? meta.syncedUntil.minus({ days: 1 }) : yesterdayUtc()

        await this.syncDailyStatsBackwards(startDay, meta.syncStartDate, meta)

        meta.syncStatus = SyncStatus.SUCCESS
        meta.lastSuccessSyncDate = yesterdayUtc()
        meta.lastError = null
        await meta.save()

        if (isInitialSync) {
          this.logger.info('Первоначальная синхронизация завершена успешно')
        } else {
          this.logger.info('Синхронизация возобновлена и успешно завершена')
        }
      } else if (
        meta.syncStatus === SyncStatus.SUCCESS ||
        (force && meta.syncStatus === SyncStatus.ERROR)
      ) {
        await this.dailySync(meta)
      }
    } catch (error) {
      await this.handleSyncError(meta, error)
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Core Sync Methods
  // -------------------------------------------------------------------------

  private async dailySync(meta: IntegrationMetadata): Promise<void> {
    const lastTimestamp = meta.lastTimestamp || (await this.api.getServerTimestamp())
    this.logger.info(
      `Началась ежедневная синхронизация. Проверка изменений с момента: ${lastTimestamp}`
    )

    let newTimestamp: string
    let borderDateStr: string | undefined

    try {
      const campaignRecords = await Campaign.query().where('source', SOURCE)
      const campaignIds = campaignRecords.map((c: any) => Number(c.campaignId))

      const changes = await YandexRetryService.call(() =>
        this.api.checkChanges(lastTimestamp, campaignIds)
      )
      newTimestamp = changes.Timestamp

      if (changes.CampaignsStat && changes.CampaignsStat.length > 0) {
        const borderDates = changes.CampaignsStat.map((c: any) => c.BorderDate).filter(
          (d: any): d is string => !!d
        )

        if (borderDates.length > 0) {
          borderDates.sort()
          borderDateStr = borderDates[0]
        }
      }
    } catch (error) {
      if (error instanceof ApiAuthError) {
        meta.syncStatus = SyncStatus.ERROR
        meta.lastError = 'auth_unavailable'
        await meta.save()
        this.logger.error('Ошибка аутентификации во время ежедневной синхронизации')
      }
      throw error
    }

    const yesterday = yesterdayUtc()
    let dateFrom: DateTime
    const dateTo: DateTime = yesterday

    if (borderDateStr) {
      dateFrom = DateTime.fromISO(borderDateStr).toUTC().startOf('day')
      this.logger.info(
        `Обнаружены изменения. Период загрузки ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    } else {
      dateFrom = daysAgoUtc(3)
      this.logger.info(
        `Изменений не обнаружено. Период активной загрузки ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    }

    if (dateFrom > dateTo) {
      dateFrom = dateTo
    }

    await this.syncDailyStatsForPeriod(dateFrom, dateTo, meta)
    meta.lastTimestamp = newTimestamp
    meta.lastSuccessSyncDate = yesterdayUtc()
    await meta.save()

    this.logger.info(`Ежедневная синхронизация завершена. Новая временная метка: ${newTimestamp}`)

    if (meta.syncStatus === SyncStatus.PARTIAL) {
      this.logger.info('Статус - partial, начальная синхронизация продолжается...')
      await this.sync()
    }
  }

  private async syncStructuralData(meta: IntegrationMetadata): Promise<void> {
    if (!meta.referenceSyncPhase || meta.referenceSyncPhase === ReferenceSyncPhase.TIMESTAMP) {
      if (meta.referenceSyncPhase !== ReferenceSyncPhase.TIMESTAMP) {
        meta.referenceSyncPhase = ReferenceSyncPhase.TIMESTAMP
        await meta.save()
      }

      this.logger.info('Синхронизация структурных данных: получение временной метки (TIMESTAMP)')
      try {
        const timestampResponse = await YandexRetryService.call(() => this.api.getServerTimestamp())
        meta.lastTimestamp = (timestampResponse as any).Timestamp || String(timestampResponse)
        meta.referenceSyncPhase = ReferenceSyncPhase.CAMPAIGNS
        await meta.save()
      } catch (error: any) {
        this.logger.error(`Ошибка при получении временной метки: ${error.message}`)
        throw new ApiFatalError('timestamp_unknown')
      }
    }

    this.logger.info(`Синхронизация структурных данных. Текущая фаза: ${meta.referenceSyncPhase}`)

    // --- Campaigns ---
    if (meta.referenceSyncPhase === ReferenceSyncPhase.CAMPAIGNS) {
      try {
        await db.transaction(async (trx) => {
          const campaigns = await YandexRetryService.call(() => this.api.getCampaigns())
          this.logger.info(`Получение кампаний: ${campaigns.length}`)

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
      } catch (error) {
        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiReportUnpossible ||
          error instanceof ApiRetryExhaustedError
        ) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Ошибка при получении кампаний: ${message}`)
        throw new ApiFatalError('campaigns_unknown')
      }
      meta.referenceSyncPhase = ReferenceSyncPhase.AD_GROUPS
      await meta.save()
    }

    // --- AdGroups ---
    if (meta.referenceSyncPhase === ReferenceSyncPhase.AD_GROUPS) {
      try {
        await db.transaction(async (trx) => {
          const campaignRecords = await Campaign.query({ client: trx }).where('source', SOURCE)
          const campaignIds = campaignRecords.map((c: any) => Number(c.campaignId))

          if (campaignIds.length > 0) {
            const adGroups = await YandexRetryService.call(() => this.api.getAdGroups(campaignIds))
            this.logger.info(`Получение групп объявлений: ${adGroups.length}`)

            const campaignIdMap = new Map(
              campaignRecords.map((c: any) => [Number(c.campaignId), c.id])
            )

            for (const g of adGroups) {
              const internalCampaignId = campaignIdMap.get(g.CampaignId)
              if (!internalCampaignId) continue

              await AdGroup.updateOrCreate(
                { source: SOURCE, groupId: g.Id },
                { name: g.Name, campaignId: internalCampaignId },
                { client: trx }
              )
            }
          }
        })
      } catch (error) {
        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiReportUnpossible ||
          error instanceof ApiRetryExhaustedError
        ) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Ошибка при получении групп объявлений: ${message}`)
        throw new ApiFatalError('adgroups_unknown')
      }
      meta.referenceSyncPhase = ReferenceSyncPhase.ADS
      await meta.save()
    }

    // --- Ads ---
    if (meta.referenceSyncPhase === ReferenceSyncPhase.ADS) {
      try {
        await db.transaction(async (trx) => {
          const adGroupRecords = await AdGroup.query({ client: trx }).where('source', SOURCE)
          const adGroupIds = adGroupRecords.map((g: any) => Number(g.groupId))

          if (adGroupIds.length > 0) {
            const ads = await YandexRetryService.call(() => this.api.getAds(adGroupIds))
            this.logger.info(`Получение объявлений: ${ads.length}`)

            const adGroupIdMap = new Map(adGroupRecords.map((g: any) => [Number(g.groupId), g.id]))

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
          }
        })
      } catch (error) {
        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiReportUnpossible ||
          error instanceof ApiRetryExhaustedError
        ) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Ошибка при получении объявлений: ${message}`)
        throw new ApiFatalError('ads_unknown')
      }
      meta.referenceSyncPhase = ReferenceSyncPhase.DONE
      this.logger.info(`Фаза обновлена на: ${meta.referenceSyncPhase}`)
      await meta.save()
      this.logger.info('Фаза сохранена в БД')
    }

    this.logger.info('Синхронизация структурных данных выполнена')
  }

  private async syncDailyStatsBackwards(
    startDay: DateTime,
    endDay: DateTime,
    meta: IntegrationMetadata
  ): Promise<void> {
    let periodEnd = startDay

    while (periodEnd >= endDay) {
      const periodStart = await this.syncPeriodAdaptive(periodEnd, endDay, meta)

      await meta.refresh()
      periodEnd = periodStart ? periodStart.minus({ days: 1 }) : yesterdayUtc()
    }
  }

  private async syncPeriodAdaptive(
    periodEnd: DateTime,
    hardLimit: DateTime,
    meta: IntegrationMetadata
  ): Promise<DateTime> {
    for (const stepDays of PERIOD_STEPS_DAYS) {
      const rawStart = periodEnd.minus({ days: stepDays - 1 }).startOf('day')
      const periodStart = rawStart < hardLimit ? hardLimit : rawStart

      this.logger.info(
        `Попытка загрузки периода в ${periodStart.toISODate()} – ${periodEnd.toISODate()} (${stepDays} дней)`
      )

      try {
        await this.syncDailyStatsForPeriod(periodStart, periodEnd, meta)
        meta.lastSuccessSyncDate = yesterdayUtc()
        await meta.save()

        this.logger.info(
          `Успешно загруженный период: ${periodStart.toISODate()} – ${periodEnd.toISODate()}`
        )
        return periodStart
      } catch (error: any) {
        if (error instanceof ApiRetryExhaustedError || error instanceof ApiReportUnpossible) {
          if (stepDays === PERIOD_STEPS_DAYS[PERIOD_STEPS_DAYS.length - 1]) {
            this.logger.warn(
              `Минимальный период (${stepDays} дней) провален. Попытки исчерпаны/Отчет невозможен`
            )
            throw error
          }
          this.logger.warn(
            `Период в ${stepDays} дней провален (${error.name}), сокращение периода...`
          )
          continue
        }
        throw error
      }
    }

    // Эта строка никогда не должна быть достигнута
    throw new Error('Не удалось загрузить данные ни на одном периоде')
  }

  private async syncDailyStatsForPeriod(
    dateFrom: DateTime,
    dateTo: DateTime,
    meta: IntegrationMetadata
  ): Promise<void> {
    const stats = await YandexRetryService.call(() => this.api.getDailyStats({ dateFrom, dateTo }))

    if (stats.length === 0) return

    const yandexAdIds: number[] = Array.from(new Set(stats.map((s: any) => Number(s.AdId))))
    const adRecords = await Ad.query().whereIn('ad_id', yandexAdIds).where('source', SOURCE)
    const adIdMap = new Map(adRecords.map((a: any) => [Number(a.adId), a.id]))

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

      meta.syncedUntil = dateFrom
      meta.useTransaction(trx)
      await meta.save()
    })
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Helpers
  // -------------------------------------------------------------------------

  private async getMeta(): Promise<IntegrationMetadata> {
    return IntegrationMetadata.firstOrCreate(
      { source: SOURCE },
      {
        lastTimestamp: null,
        syncStartDate: null,
        syncedUntil: null,
        lastSuccessSyncDate: null,
        syncStatus: null,
        lastError: null,
        referenceSyncPhase: null,
        credentials: null,
      }
    )
  }

  private async handleSyncError(meta: IntegrationMetadata, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof ApiAuthError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = 'auth_unavailable'
      this.logger.error(`Ошибка синхронизации (авторизация): ${message}`)
    } else if (error instanceof ApiFatalError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = message
      this.logger.error(`Фатальная ошибка API: ${message}`)
    } else if (error instanceof ApiLimitError) {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = 'api_limit_exceeded'
      this.logger.error(`Лимит API исчерпан: ${message}`)
    } else if (error instanceof ApiReportUnpossible || error instanceof ApiRetryExhaustedError) {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = error instanceof ApiReportUnpossible ? 'report_unavailable' : 'timeout'
      this.logger.warn(`Синхронизация прервана на отчетах: ${message}`)
    } else if (error instanceof SyncError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = message
      this.logger.error(`Ошибка метаданных: ${message}`)
    } else {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = message
      this.logger.warn(`Синхронизация прервана (partial). Причина: ${message}`)
    }

    await meta.save()
  }
}
