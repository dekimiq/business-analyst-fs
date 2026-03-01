import type { DateTime } from 'luxon'
import type { YandexCampaign, YandexAdGroup, YandexAd, YandexDailyStat } from '../types/yandex.js'

/**
 * Контракт для клиента Яндекс.Директ.
 *
 * Любая реализация (реальная или мок) должна удовлетворять этому интерфейсу.
 * YandexSyncService работает только с этим контрактом — не знает, кто его реализует.
 */
export interface IYandexApiClient {
  /** Проверка связи с API. Возвращает true если токен валиден. */
  ping(): Promise<boolean>
  getCampaigns(): Promise<YandexCampaign[]>
  getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]>
  getAds(adGroupIds: number[]): Promise<YandexAd[]>
  getDailyStats(params: { dateFrom: DateTime; dateTo: DateTime }): Promise<YandexDailyStat[]>
}
