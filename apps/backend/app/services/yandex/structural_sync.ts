import db from '@adonisjs/lucid/services/db'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import type { YandexSyncContext } from './yandex_sync_context.ts'
import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiReportUnpossible,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'
import { YandexRetryService } from '#utils/yandex_retry'

/**
 * 1. Загрузка Timestamp (Момент получения серверного времени)
 */
export async function syncTimestamp(ctx: YandexSyncContext): Promise<void> {
  const { meta, api, logger } = ctx

  try {
    const timestampResponse = await YandexRetryService.call(() => api.getServerTimestamp())
    const tsValue = (timestampResponse as any).Timestamp || String(timestampResponse)
    logger.info(`[Sync] Получен Timestamp: ${tsValue}`)
    meta.lastTimestamp = tsValue
  } catch (error: any) {
    logger.error(`Ошибка при получении временной метки Яндекса: ${error.message}`)
    throw new ApiFatalError('timestamp_unknown')
  }
}

/**
 * 2. Синхронизация списка Кампаний
 */
export async function syncCampaigns(ctx: YandexSyncContext): Promise<void> {
  const { api, logger, source } = ctx

  let campaigns
  try {
    campaigns = await YandexRetryService.call(() => api.getCampaigns())
    logger.info(`Получение кампаний из Яндекс: ${campaigns.length} шт.`)

    if (campaigns.length === 0) {
      throw new ApiFatalError('yandex_no_campaigns_found')
    }
  } catch (error: any) {
    const message = error.message || error.toString()
    if (
      error instanceof ApiAuthError ||
      error instanceof ApiLimitError ||
      error instanceof ApiReportUnpossible
    ) {
      error.message = `campaigns_unknown (${message})`
      throw error
    }
    logger.error(`Ошибка сети при получении кампаний: ${message}`)
    throw new ApiFatalError(`campaigns_unknown (${message})`)
  }

  await db.transaction(async (trx) => {
    for (const c of campaigns) {
      await Campaign.updateOrCreate(
        { source, campaignId: String(c.Id) },
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
}

/**
 * 3. Синхронизация Групп Объявлений
 */
export async function syncAdGroups(ctx: YandexSyncContext): Promise<void> {
  const { api, logger, source } = ctx

  const campaignRecords = await Campaign.query().where('source', source)
  const campaignIds = campaignRecords.map((c) => Number(c.campaignId))

  if (campaignIds.length === 0) {
    throw new ApiFatalError('yandex_no_campaigns_in_db')
  }

  let adGroups
  try {
    adGroups = await YandexRetryService.call(() => api.getAdGroups(campaignIds))
    logger.info(`Получено групп объявлений: ${adGroups.length} шт.`)

    if (adGroups.length === 0) {
      throw new ApiFatalError('yandex_no_adgroups_found')
    }
  } catch (error: any) {
    const message = error.message || error.toString()
    if (
      error instanceof ApiAuthError ||
      error instanceof ApiLimitError ||
      error instanceof ApiReportUnpossible
    ) {
      error.message = `adgroups_unknown (${message})`
      throw error
    }
    logger.error(`Ошибка сети при получении Групп объявлений: ${message}`)
    throw new ApiFatalError(`adgroups_unknown (${message})`)
  }

  const campaignIdMap = new Map(campaignRecords.map((c) => [String(c.campaignId), c.id]))

  await db.transaction(async (trx) => {
    for (const g of adGroups) {
      const internalCampaignPk = campaignIdMap.get(String(g.CampaignId))
      if (!internalCampaignPk) continue

      await AdGroup.updateOrCreate(
        { source, groupId: String(g.Id) },
        { name: g.Name, campaignPk: internalCampaignPk },
        { client: trx }
      )
    }
  })
}

/**
 * 4. Синхронизация самих Объявлений
 */
export async function syncAds(ctx: YandexSyncContext): Promise<void> {
  const { api, logger, source } = ctx

  const adGroupRecords = await AdGroup.query().where('source', source)
  const adGroupIds = adGroupRecords.map((g) => Number(g.groupId))

  if (adGroupIds.length === 0) {
    throw new ApiFatalError('yandex_no_adgroups_in_db')
  }

  let ads
  try {
    ads = await YandexRetryService.call(() => api.getAds(adGroupIds))
    logger.info(`Получено объявлений: ${ads.length} шт.`)

    if (ads.length === 0) {
      throw new ApiFatalError('yandex_no_ads_found')
    }
  } catch (error: any) {
    const message = error.message || error.toString()
    if (
      error instanceof ApiAuthError ||
      error instanceof ApiLimitError ||
      error instanceof ApiReportUnpossible
    ) {
      error.message = `ads_unknown (${message})`
      throw error
    }
    logger.error(`Ошибка сети при получении Объявлений: ${message}`)
    throw new ApiFatalError(`ads_unknown (${message})`)
  }

  const adGroupIdMap = new Map(adGroupRecords.map((g) => [String(g.groupId), g.id]))

  await db.transaction(async (trx) => {
    for (const a of ads) {
      const internalGroupPk = adGroupIdMap.get(String(a.AdGroupId))
      if (!internalGroupPk) continue

      await Ad.updateOrCreate(
        { source, adId: String(a.Id) },
        {
          groupPk: internalGroupPk,
          title: a.TextAd?.Title ?? null,
          text: a.TextAd?.Text ?? null,
        },
        { client: trx }
      )
    }
  })
}
