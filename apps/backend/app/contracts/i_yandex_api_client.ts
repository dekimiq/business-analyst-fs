import type { DateTime } from 'luxon'
import type { YandexCampaign, YandexAdGroup, YandexAd, YandexDailyStat } from '../types/yandex.js'

export interface IYandexApiClient {
  ping(): Promise<boolean>
  getCampaigns(): Promise<YandexCampaign[]>
  getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]>
  getAds(adGroupIds: number[]): Promise<YandexAd[]>
  getDailyStats(params: { dateFrom: DateTime; dateTo: DateTime }): Promise<YandexDailyStat[]>
  getServerTimestamp(): Promise<string>
  checkChanges(
    lastTimestamp: string,
    campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }>
}
