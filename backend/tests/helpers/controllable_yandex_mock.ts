import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import type {
  YandexCampaign,
  YandexAdGroup,
  YandexAd,
  YandexDailyStat,
} from '../../app/types/yandex.js'
import { DateTime } from 'luxon'

/**
 * Программируемый мок для тестов.
 * Позволяет задать данные и поведение (включая ошибки) перед каждым тестом.
 *
 * Поведение getDailyStats управляется через dailyStatsBehavior:
 *   - Map<'YYYY-MM-DD', YandexDailyStat[]> → возвращает данные для этой даты
 *   - Map<'YYYY-MM-DD', Error>             → бросает ошибку при попадании в этот день
 */
export class ControllableYandexMock implements IYandexApiClient {
  // Данные которые вернут методы
  campaigns: YandexCampaign[] = []
  adGroups: YandexAdGroup[] = []
  ads: YandexAd[] = []

  // Поведение getDailyStats: Map<'YYYY-MM-DD', YandexDailyStat[] | Error>
  // Если значение — Error, метод бросает его при попадании в эту дату в диапазоне
  dailyStatsBehavior: Map<string, YandexDailyStat[] | Error> = new Map()

  // Произвольный override для getDailyStats (имеет приоритет над dailyStatsBehavior)
  getDailyStatsOverride:
    | ((params: { dateFrom: DateTime; dateTo: DateTime }) => Promise<YandexDailyStat[]>)
    | null = null

  // Счётчики вызовов для assert
  callCount = {
    ping: 0,
    getCampaigns: 0,
    getAdGroups: 0,
    getAds: 0,
    getDailyStats: 0,
  }

  // Аргументы последнего вызова getDailyStats (для проверки clamp)
  lastDailyStatsArgs: { dateFrom: DateTime; dateTo: DateTime } | null = null

  async ping(): Promise<boolean> {
    this.callCount.ping++
    return true
  }

  async getCampaigns(): Promise<YandexCampaign[]> {
    this.callCount.getCampaigns++
    return this.campaigns
  }

  async getAdGroups(_campaignIds: number[]): Promise<YandexAdGroup[]> {
    this.callCount.getAdGroups++
    return this.adGroups
  }

  async getAds(_adGroupIds: number[]): Promise<YandexAd[]> {
    this.callCount.getAds++
    return this.ads
  }

  async getDailyStats({
    dateFrom,
    dateTo,
  }: {
    dateFrom: DateTime
    dateTo: DateTime
  }): Promise<YandexDailyStat[]> {
    this.callCount.getDailyStats++
    this.lastDailyStatsArgs = { dateFrom, dateTo }

    // Произвольный override имеет наивысший приоритет
    if (this.getDailyStatsOverride) {
      return this.getDailyStatsOverride({ dateFrom, dateTo })
    }

    const results: YandexDailyStat[] = []
    let current = dateFrom.startOf('day')
    const end = dateTo.startOf('day')

    while (current <= end) {
      const key = current.toISODate()!
      const behavior = this.dailyStatsBehavior.get(key)

      if (behavior instanceof Error) {
        throw behavior
      }

      if (behavior) {
        results.push(...behavior)
      }

      current = current.plus({ days: 1 })
    }

    return results
  }

  async getServerTimestamp(): Promise<string> {
    return DateTime.now().toMillis().toString()
  }

  async checkChanges(_lastTimestamp: string): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }> {
    return { Timestamp: DateTime.now().toMillis().toString(), CampaignsStat: [] }
  }

  /** Сброс счётчиков между тестами */
  resetCallCounts(): void {
    this.callCount.ping = 0
    this.callCount.getCampaigns = 0
    this.callCount.getAdGroups = 0
    this.callCount.getAds = 0
    this.callCount.getDailyStats = 0
    this.lastDailyStatsArgs = null
  }
}
