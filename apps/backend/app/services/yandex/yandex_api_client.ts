import axios, { type AxiosInstance } from 'axios'
import { DateTime } from 'luxon'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import type {
  YandexCampaign,
  YandexGetCampaigns,
  YandexAdGroup,
  YandexGetAdGroups,
  YandexAd,
  YandexGetAds,
  YandexDailyStat,
} from '#types/yandex'
import { YandexRetryService } from '#utils/yandex_retry'

/**
 * Вспомогательная функция: разбивает массив на чанки заданного размера.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/**
 * Реальный HTTP-клиент для API Яндекс.Директ.
 * Принимает OAuth-токен, создаёт axios-инстанс с базовым URL JSON API v5.
 */
export class YandexApiClient implements IYandexApiClient {
  private readonly client: AxiosInstance

  constructor(token: string) {
    this.client = axios.create({
      baseURL: 'https://api.direct.yandex.com/json/v5/',
      proxy: false,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept-Language': 'ru',
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Ping
  // ---------------------------------------------------------------------------

  /**
   * Проверяет валидность токена минимальным запросом к API (getCampaigns с Limit=1).
   */
  async ping(): Promise<boolean> {
    try {
      await YandexRetryService.call(() =>
        this.client.post('campaigns', {
          method: 'get',
          params: {
            SelectionCriteria: {},
            FieldNames: ['Id'],
            Page: { Limit: 1, Offset: 0 },
          },
        })
      )
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Пагинация
  // ---------------------------------------------------------------------------

  private async fetchAllPages<TItem, TResult extends { result: { LimitedBy?: number } }>(
    fetchPage: (page: { Limit: number; Offset: number }) => Promise<{ data: TResult }>,
    extractItems: (result: TResult) => TItem[]
  ): Promise<TItem[]> {
    const all: TItem[] = []
    let offset = 0
    const limit = 10_000

    while (true) {
      const response = await YandexRetryService.call(() =>
        fetchPage({ Limit: limit, Offset: offset })
      )
      const items = extractItems(response.data)
      all.push(...items)
      if (!response.data.result.LimitedBy) break
      offset = response.data.result.LimitedBy
    }

    return all
  }

  // ---------------------------------------------------------------------------
  // Campaigns / AdGroups / Ads
  // ---------------------------------------------------------------------------

  async getCampaigns(): Promise<YandexCampaign[]> {
    return this.fetchAllPages<YandexCampaign, YandexGetCampaigns>(
      (page) =>
        this.client.post('campaigns', {
          method: 'get',
          params: {
            SelectionCriteria: {},
            FieldNames: ['Id', 'Name', 'Type', 'Status', 'State'],
            Page: page,
          },
        }),
      (result) => result.result.Campaigns
    )
  }

  async getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]> {
    if (campaignIds.length === 0) {
      throw new Error('API запрос `adgroups`: список CampaignIds не может быть пустым.')
    }

    const chunks = chunkArray(campaignIds, 10)
    const all: YandexAdGroup[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAdGroup, YandexGetAdGroups>(
        (page) =>
          this.client.post('adgroups', {
            method: 'get',
            params: {
              SelectionCriteria: { CampaignIds: chunk },
              FieldNames: ['Id', 'Name', 'CampaignId'],
              Page: page,
            },
          }),
        (result) => result.result.AdGroups
      )
      all.push(...items)
    }

    return all
  }

  async getAds(adGroupIds: number[]): Promise<YandexAd[]> {
    if (adGroupIds.length === 0) {
      throw new Error('API запрос `ads`: список AdGroupIds не может быть пустым.')
    }

    const chunks = chunkArray(adGroupIds, 1_000)
    const all: YandexAd[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAd, YandexGetAds>(
        (page) =>
          this.client.post('ads', {
            method: 'get',
            params: {
              SelectionCriteria: { AdGroupIds: chunk },
              FieldNames: ['Id', 'AdGroupId', 'Type', 'State', 'Status'],
              TextAdFieldNames: ['Title', 'Text'],
              Page: page,
            },
          }),
        (result) => result.result.Ads
      )
      all.push(...items)
    }

    return all
  }

  // ---------------------------------------------------------------------------
  // Daily stats (Reports API — TSV)
  // ---------------------------------------------------------------------------

  async getDailyStats({
    dateFrom,
    dateTo,
  }: {
    dateFrom: DateTime
    dateTo: DateTime
  }): Promise<YandexDailyStat[]> {
    if (!dateFrom.isValid || !dateTo.isValid) {
      throw new Error('API запрос `reports`: некорректная дата.')
    }

    const from = dateFrom.toISODate()!
    const to = dateTo.toISODate()!

    const allStats: YandexDailyStat[] = []
    let offset = 0
    const limit = 1_000_000

    while (true) {
      const response = await YandexRetryService.call(() =>
        this.client.post<string>(
          'reports',
          {
            params: {
              SelectionCriteria: { DateFrom: from, DateTo: to },
              FieldNames: ['Date', 'AdId', 'Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc'],
              ReportName: `daily_${from}_${to}_${Date.now()}_${offset}`,
              ReportType: 'AD_PERFORMANCE_REPORT',
              DateRangeType: 'CUSTOM_DATE',
              Format: 'TSV',
              IncludeVAT: 'YES',
              IncludeDiscount: 'NO',
              Page: { Limit: limit, Offset: offset },
            },
          },
          {
            headers: {
              returnMoneyInMicros: 'true',
              skipReportHeader: 'true',
              skipColumnHeader: 'false',
              skipReportSummary: 'true',
            },
            responseType: 'text',
          }
        )
      )

      const chunkStats = this.parseTsvReport(response.data)
      allStats.push(...chunkStats)

      const nextOffset = response.headers['limitedby']
      if (!nextOffset) break

      offset = Number(nextOffset)
    }

    return allStats
  }

  // ---------------------------------------------------------------------------
  // Changes API
  // ---------------------------------------------------------------------------

  async getServerTimestamp(): Promise<string> {
    try {
      const result = await this.checkChanges('1970-01-01T00:00:00Z')
      return result.Timestamp
    } catch {
      return DateTime.now().toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'")
    }
  }

  async checkChanges(
    lastTimestamp: string,
    campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }> {
    const params: Record<string, unknown> = { Timestamp: lastTimestamp }

    if (campaignIds && campaignIds.length > 0) {
      params.FieldNames = ['CampaignsStat']
      params.CampaignIds = campaignIds.slice(0, 10_000)
    }

    const response = await YandexRetryService.call(() =>
      this.client.post('changes', { method: 'check', params })
    )

    return response.data.result as {
      Timestamp: string
      CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
    }
  }

  // ---------------------------------------------------------------------------
  // TSV parser
  // ---------------------------------------------------------------------------

  private parseTsvReport(tsv: string): YandexDailyStat[] {
    const lines = tsv.trim().split('\n')
    if (lines.length < 2) return []

    const [headerLine, ...dataLines] = lines
    const headers = headerLine.split('\t')
    const idx = (name: string) => headers.indexOf(name)

    return dataLines
      .filter((line) => line.trim() && !line.startsWith('Total'))
      .map((line) => {
        const cols = line.split('\t')
        const avgCpcRaw = cols[idx('AvgCpc')]
        const impressions = Number(cols[idx('Impressions')])
        const cost = Number(cols[idx('Cost')])

        return {
          Date: cols[idx('Date')],
          AdId: Number(cols[idx('AdId')]),
          Impressions: impressions,
          Clicks: Number(cols[idx('Clicks')]),
          Cost: cost,
          Ctr: Number(cols[idx('Ctr')]),
          AvgCpc: avgCpcRaw === '--' || avgCpcRaw === null ? null : Number(avgCpcRaw),
          AvgCpm: impressions > 0 ? Math.floor((cost / impressions) * 1000) : 0,
        }
      })
  }
}
