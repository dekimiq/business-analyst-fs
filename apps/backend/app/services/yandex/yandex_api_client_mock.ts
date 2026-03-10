import { type DateTime } from 'luxon'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import type { YandexCampaign, YandexAdGroup, YandexAd, YandexDailyStat } from '#types/yandex'

// ---------------------------------------------------------------------------
// Фиксированные данные — имитируют реальный рекламный кабинет
// ---------------------------------------------------------------------------

const MOCK_CAMPAIGNS: YandexCampaign[] = [
  {
    Id: 10000001,
    Name: 'Кампания: Основная',
    Type: 'TEXT_CAMPAIGN',
    Status: 'ACCEPTED',
    State: 'ON',
  },
  {
    Id: 10000002,
    Name: 'Кампания: Ретаргетинг',
    Type: 'TEXT_CAMPAIGN',
    Status: 'ACCEPTED',
    State: 'ON',
  },
]

const MOCK_AD_GROUPS: YandexAdGroup[] = [
  { Id: 20000001, Name: 'Группа: Общие запросы', CampaignId: 10000001 },
  { Id: 20000002, Name: 'Группа: Брендовые запросы', CampaignId: 10000001 },
  { Id: 20000003, Name: 'Группа: Ретаргетинг — Посетители', CampaignId: 10000002 },
]

const MOCK_ADS: YandexAd[] = [
  {
    Id: 30000001,
    AdGroupId: 20000001,
    Type: 'TEXT_AD',
    State: 'ON',
    Status: 'ACCEPTED',
    TextAd: { Title: 'Официальный сайт', Text: 'Лучшие условия. Онлайн-заявка.' },
  },
  {
    Id: 30000002,
    AdGroupId: 20000001,
    Type: 'TEXT_AD',
    State: 'ON',
    Status: 'ACCEPTED',
    TextAd: { Title: 'Быстрый старт', Text: 'Результат с первого дня.' },
  },
  {
    Id: 30000003,
    AdGroupId: 20000002,
    Type: 'TEXT_AD',
    State: 'ON',
    Status: 'ACCEPTED',
    TextAd: { Title: 'Бренд | Официально', Text: 'Прямая ссылка на сайт.' },
  },
  {
    Id: 30000004,
    AdGroupId: 20000003,
    Type: 'TEXT_AD',
    State: 'ON',
    Status: 'ACCEPTED',
    TextAd: { Title: 'Вернитесь к нам', Text: 'Специальное предложение для вас.' },
  },
]

const AD_IDS = MOCK_ADS.map((a) => a.Id)

/**
 * Генерирует детерминированные статы для одного дня (seed = дата).
 */
function generateStatsForDay(date: string): YandexDailyStat[] {
  const seed = date.replace(/-/g, '')
  const base = Number(seed) % 1000

  return AD_IDS.map((adId, i) => {
    const impressions = ((base + i * 37 + 200) % 3000) + 100
    const clicks = Math.max(1, Math.floor(impressions * 0.04))
    const cost = Math.floor(clicks * (150_000 + (base % 100) * 1_000))
    const avgCpc = clicks > 0 ? Math.floor(cost / clicks) : null
    const avgCpm = Math.floor((cost / impressions) * 1000)
    const ctr = Number(((clicks / impressions) * 100).toFixed(2))

    return {
      Date: date,
      AdId: adId,
      Impressions: impressions,
      Clicks: clicks,
      Cost: cost,
      Ctr: ctr,
      AvgCpc: avgCpc,
      AvgCpm: avgCpm,
    }
  })
}

// ---------------------------------------------------------------------------
// Мок-реализация контракта (для тестов и локальной разработки)
// ---------------------------------------------------------------------------

export class YandexApiClientMock implements IYandexApiClient {
  private readonly DELAY_MS = 50

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.DELAY_MS))
  }

  async ping(): Promise<boolean> {
    await this.delay()
    return true
  }

  async getCampaigns(): Promise<YandexCampaign[]> {
    await this.delay()
    return MOCK_CAMPAIGNS
  }

  async getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]> {
    await this.delay()
    return MOCK_AD_GROUPS.filter((g) => campaignIds.includes(g.CampaignId))
  }

  async getAds(adGroupIds: number[]): Promise<YandexAd[]> {
    await this.delay()
    return MOCK_ADS.filter((a) => adGroupIds.includes(a.AdGroupId))
  }

  async getServerTimestamp(): Promise<string> {
    await this.delay()
    return '2024-01-01T00:00:00Z'
  }

  async checkChanges(
    _lastTimestamp: string,
    _campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }> {
    await this.delay()
    return { Timestamp: '2024-01-01T00:00:00Z', CampaignsStat: [] }
  }

  async getDailyStats({
    dateFrom,
    dateTo,
  }: {
    dateFrom: DateTime
    dateTo: DateTime
  }): Promise<YandexDailyStat[]> {
    await this.delay()
    const results: YandexDailyStat[] = []
    let current = dateFrom.startOf('day')
    const end = dateTo.startOf('day')

    while (current <= end) {
      results.push(...generateStatsForDay(current.toISODate()!))
      current = current.plus({ days: 1 })
    }

    return results
  }
}
