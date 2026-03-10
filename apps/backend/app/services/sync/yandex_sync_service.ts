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
  ApiRetryExhaustedError,
  ApiRetryService,
} from '#utils/api_retry'
import { yandexRetryConfig } from '#app_config/api/yandex_retry_config'
import type { ISyncService } from '@project/shared'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

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

  async isReady(): Promise<boolean> {
    const meta = await this.getMeta()
    return !!meta.token && !!meta.syncStartDate
  }

  async getDataAvailability(): Promise<{ availableUntil: string | null }> {
    const meta = await this.getMeta()

    if (meta.syncStatus === SyncStatus.INITIALIZING || meta.syncStatus === SyncStatus.PENDING) {
      return { availableUntil: null }
    }

    if (!meta.syncStatus || !meta.currentSyncDate) {
      return { availableUntil: null }
    }

    if (meta.syncStatus !== SyncStatus.SUCCESS) {
      return { availableUntil: meta.currentSyncDate.toISODate() }
    }

    return { availableUntil: null }
  }

  async sync(): Promise<void> {
    const meta = await this.getMeta()

    if (!meta.syncStartDate) {
      throw new ApiFatalError(
        'syncStartDate is not configured. Set sync date before starting synchronization.'
      )
    }

    this.logger.info(`Sync started. Current status: ${meta.syncStatus}`)

    try {
      // 1. Initial Sync / Initializing
      if (meta.syncStatus === null || meta.syncStatus === SyncStatus.INITIALIZING) {
        if (meta.syncStatus === null) {
          meta.syncStatus = SyncStatus.INITIALIZING
          await meta.save()
        }

        await this.syncStructuralData(meta)

        if (!meta.lastTimestamp) {
          const timestampResponse = await ApiRetryService.call(yandexRetryConfig, () =>
            this.api.getServerTimestamp()
          )
          meta.lastTimestamp = (timestampResponse as any).Timestamp || String(timestampResponse)
          await meta.save()
        }

        const startDay = meta.currentSyncDate
          ? meta.currentSyncDate.minus({ days: 1 })
          : DateTime.now().minus({ days: 1 }).startOf('day')

        await this.syncDailyStatsBackwards(startDay, meta.syncStartDate, meta)

        meta.syncStatus = SyncStatus.SUCCESS
        meta.lastSyncAt = DateTime.now()
        await meta.save()
        this.logger.info('Initial sync completed successfully.')
      }
      // 2. Daily Sync
      else if (meta.syncStatus === SyncStatus.SUCCESS) {
        await this.dailySync(meta)
      }
      // 3. Resume from Partial or Error
      else if (meta.syncStatus === SyncStatus.ERROR || meta.syncStatus === SyncStatus.PARTIAL) {
        this.logger.info(`Resuming sync from status: ${meta.syncStatus}`)

        // If structural data not finished, sync it
        if (meta.referenceSyncPhase !== ReferenceSyncPhase.DONE) {
          await this.syncStructuralData(meta)
        }

        const startDay = meta.currentSyncDate
          ? meta.currentSyncDate.minus({ days: 1 })
          : DateTime.now().minus({ days: 1 }).startOf('day')

        await this.syncDailyStatsBackwards(startDay, meta.syncStartDate, meta)

        meta.syncStatus = SyncStatus.SUCCESS
        meta.lastSyncAt = DateTime.now()
        await meta.save()
        this.logger.info('Sync resumed and completed successfully.')
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
    this.logger.info(`Daily sync started. Checking changes since: ${lastTimestamp}`)

    let newTimestamp: string
    let borderDateStr: string | undefined

    try {
      const campaignRecords = await Campaign.query().where('source', SOURCE)
      const campaignIds = campaignRecords.map((c: any) => Number(c.campaignId))

      const changes = await ApiRetryService.call(yandexRetryConfig, () =>
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
        meta.lastError = 'token_error'
        await meta.save()
        this.logger.error('Authentication error during daily sync.')
      }
      throw error
    }

    const yesterday = DateTime.now().minus({ days: 1 }).startOf('day')
    let dateFrom: DateTime
    const dateTo: DateTime = yesterday

    if (borderDateStr) {
      dateFrom = DateTime.fromISO(borderDateStr, { zone: 'Europe/Moscow' }).startOf('day')
      this.logger.info(
        `Changes detected. Loading period ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    } else {
      dateFrom = DateTime.now().minus({ days: 3 }).startOf('day')
      this.logger.info(
        `No changes detected. Proactive loading period ${dateFrom.toISODate()} - ${dateTo.toISODate()}`
      )
    }

    if (dateFrom > dateTo) {
      dateFrom = dateTo
    }

    await this.syncDailyStatsForPeriod(dateFrom, dateTo)
    meta.lastTimestamp = newTimestamp
    meta.lastSyncAt = DateTime.now()
    await meta.save()

    this.logger.info(`Daily sync completed. New Timestamp: ${newTimestamp}`)

    if (meta.syncStatus === SyncStatus.PARTIAL) {
      this.logger.info('Status is partial, continuing initial sync...')
      await this.sync()
    }
  }

  private async syncStructuralData(meta: IntegrationMetadata): Promise<void> {
    this.logger.info('Syncing structural data...')

    let phase = meta.referenceSyncPhase || ReferenceSyncPhase.CAMPAIGNS

    // --- Campaigns ---
    if (phase === ReferenceSyncPhase.CAMPAIGNS) {
      await db.transaction(async (trx) => {
        const campaigns = await ApiRetryService.call(yandexRetryConfig, () =>
          this.api.getCampaigns()
        )
        this.logger.info(`Fetched campaigns: ${campaigns.length}`)

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
      meta.referenceSyncPhase = ReferenceSyncPhase.AD_GROUPS
      await meta.save()
      phase = ReferenceSyncPhase.AD_GROUPS
    }

    // --- AdGroups ---
    if (phase === ReferenceSyncPhase.AD_GROUPS) {
      await db.transaction(async (trx) => {
        const campaignRecords = await Campaign.query({ client: trx }).where('source', SOURCE)
        const campaignIds = campaignRecords.map((c: any) => Number(c.campaignId))

        if (campaignIds.length > 0) {
          const adGroups = await ApiRetryService.call(yandexRetryConfig, () =>
            this.api.getAdGroups(campaignIds)
          )
          this.logger.info(`Fetched ad groups: ${adGroups.length}`)

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
      meta.referenceSyncPhase = ReferenceSyncPhase.ADS
      await meta.save()
      phase = ReferenceSyncPhase.ADS
    }

    // --- Ads ---
    if (phase === ReferenceSyncPhase.ADS) {
      await db.transaction(async (trx) => {
        const adGroupRecords = await AdGroup.query({ client: trx }).where('source', SOURCE)
        const adGroupIds = adGroupRecords.map((g: any) => Number(g.groupId))

        if (adGroupIds.length > 0) {
          const ads = await ApiRetryService.call(yandexRetryConfig, () =>
            this.api.getAds(adGroupIds)
          )
          this.logger.info(`Fetched ads: ${ads.length}`)

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
      meta.referenceSyncPhase = ReferenceSyncPhase.DONE
      await meta.save()
    }

    this.logger.info('Structural data sync completed.')
  }

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

  private async syncPeriodAdaptive(
    periodEnd: DateTime,
    hardLimit: DateTime,
    meta: IntegrationMetadata
  ): Promise<void> {
    for (const stepDays of PERIOD_STEPS_DAYS) {
      const rawStart = periodEnd.minus({ days: stepDays - 1 }).startOf('day')
      const periodStart = rawStart < hardLimit ? hardLimit : rawStart

      this.logger.info(
        `Trying period ${periodStart.toISODate()} – ${periodEnd.toISODate()} (${stepDays} days)`
      )

      try {
        await this.syncDailyStatsForPeriod(periodStart, periodEnd)
        meta.currentSyncDate = periodStart
        await meta.save()

        this.logger.info(
          `Successfully loaded period: ${periodStart.toISODate()} – ${periodEnd.toISODate()}`
        )
        return
      } catch (error) {
        if (error instanceof ApiRetryExhaustedError) {
          if (stepDays === PERIOD_STEPS_DAYS[PERIOD_STEPS_DAYS.length - 1]) {
            this.logger.warn(`Minimum period (${stepDays} days) failed. Retries exhausted.`)
            throw error
          }
          this.logger.warn(`Period ${stepDays} days failed, splitting further...`)
          continue
        }
        throw error
      }
    }
  }

  private async syncDailyStatsForPeriod(dateFrom: DateTime, dateTo: DateTime): Promise<void> {
    const stats = await ApiRetryService.call(yandexRetryConfig, () =>
      this.api.getDailyStats({ dateFrom, dateTo })
    )

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
    })
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Helpers
  // -------------------------------------------------------------------------

  private async getMeta(): Promise<IntegrationMetadata> {
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
        referenceSyncPhase: ReferenceSyncPhase.CAMPAIGNS,
      }
    )
  }

  private async handleSyncError(meta: IntegrationMetadata, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof ApiAuthError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = 'token_error'
      this.logger.error(`Sync failed due to authentication error: ${message}`)
    } else if (error instanceof ApiFatalError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = message
      this.logger.error(`Sync failed due to fatal error: ${message}`)
    } else {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = message
      this.logger.warn(`Sync interrupted, status set to partial. Reason: ${message}`)
    }

    await meta.save()
  }
}
