import type { DateTime } from 'luxon'
import type {
  YandexCampaign,
  YandexAdGroup,
  YandexAd,
  YandexDailyStat,
  YandexCheckCampaignsResult,
  YandexCheckResult,
  ChangeFieldName,
} from '../types/yandex.js'

export interface IYandexApiClient {
  ping(): Promise<boolean>

  // Structural data
  getCampaigns(ids?: number[]): Promise<YandexCampaign[]>
  getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]>
  getAdGroupsByIds(ids: number[]): Promise<YandexAdGroup[]>
  getAds(adGroupIds: number[]): Promise<YandexAd[]>
  getAdsByIds(ids: number[]): Promise<YandexAd[]>

  // Reports
  getDailyStats(params: {
    dateFrom: DateTime
    dateTo: DateTime
    reportName?: string
  }): Promise<YandexDailyStat[]>

  // Changes API
  getServerTimestamp(): Promise<string>
  checkCampaigns(timestamp: string): Promise<YandexCheckCampaignsResult>
  check(params: {
    timestamp: string
    campaignIds: number[]
    fieldNames: ChangeFieldName[]
  }): Promise<YandexCheckResult>

  /**
   * @deprecated Используй checkCampaigns / check напрямую.
   * Оставлен для обратной совместимости.
   */
  checkChanges(
    lastTimestamp: string,
    campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }>
}
