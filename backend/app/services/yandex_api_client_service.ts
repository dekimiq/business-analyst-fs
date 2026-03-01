import axios, { AxiosInstance } from 'axios'
import { DateTime } from 'luxon'
import { withYandexRetry } from '../utils/yandex_retry.js'
import { chunkArray } from '../utils/universal.js'
import type { IYandexApiClient } from '../contracts/i_yandex_api_client.js'
import type {
  YandexCampaign,
  YandexGetCampaigns,
  YandexAdGroup,
  YandexGetAdGroups,
  YandexAd,
  YandexGetAds,
  YandexDailyStat,
} from '../types/yandex.js'

export default class YandexApiClientService implements IYandexApiClient {
  private client: AxiosInstance

  /**
   * @param token - OAuth 2.0 токен Яндекс.Директ. Читается из integration_metadata.токен
   *             (BullMQ-джоб передаёт его до создания экземпляра).
   */
  constructor(token: string) {
    this.client = axios.create({
      baseURL: 'https://api.direct.yandex.com/json/v5',
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
   * Проверяет валидность токена лёгким запросом к API.
   * Используем getCampaigns с Limit=1 — минимальный возможный запрос.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.client.post('/campaigns', {
        method: 'get',
        params: {
          SelectionCriteria: {},
          FieldNames: ['Id'],
          Page: { Limit: 1, Offset: 0 },
        },
      })
      return response.status === 200
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Pagination helper
  // ---------------------------------------------------------------------------

  private async fetchAllPages<TItem, TResult extends { result: { LimitedBy?: number } }>(
    fetchPage: (page: {
      Limit: number
      Offset: number
    }) => Promise<{ status: number; data: TResult }>
  ): Promise<TItem[]>

  private async fetchAllPages<TItem, TResult extends { result: { LimitedBy?: number } }>(
    fetchPage: (page: {
      Limit: number
      Offset: number
    }) => Promise<{ status: number; data: TResult }>,
    extractItems: (result: TResult) => TItem[]
  ): Promise<TItem[]>

  private async fetchAllPages<TItem, TResult extends { result: { LimitedBy?: number } }>(
    fetchPage: (page: {
      Limit: number
      Offset: number
    }) => Promise<{ status: number; data: TResult }>,
    extractItems?: (result: TResult) => TItem[]
  ): Promise<TItem[]> {
    const all: TItem[] = []
    let offset = 0
    const limit = 10_000

    while (true) {
      const result = await withYandexRetry(() => fetchPage({ Limit: limit, Offset: offset }))
      const items = extractItems ? extractItems(result) : (result as unknown as TItem[])
      all.push(...items)
      if (!result.result.LimitedBy) break
      offset = result.result.LimitedBy
    }

    return all
  }

  // ---------------------------------------------------------------------------
  // Campaigns / AdGroups / Ads
  // ---------------------------------------------------------------------------

  async getCampaigns(): Promise<YandexCampaign[]> {
    return this.fetchAllPages<YandexCampaign, YandexGetCampaigns>(
      (page) =>
        this.client.post('/campaigns', {
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
    const allResults: YandexAdGroup[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAdGroup, YandexGetAdGroups>(
        (page) =>
          this.client.post('/adgroups', {
            method: 'get',
            params: {
              SelectionCriteria: { CampaignIds: chunk },
              FieldNames: ['Id', 'Name', 'CampaignId'],
              Page: page,
            },
          }),
        (result) => result.result.AdGroups
      )
      allResults.push(...items)
    }

    return allResults
  }

  async getAds(adGroupIds: number[]): Promise<YandexAd[]> {
    if (adGroupIds.length === 0) {
      throw new Error('API запрос `ads`: список AdGroupIds не может быть пустым.')
    }

    const chunks = chunkArray(adGroupIds, 1_000)
    const allResults: YandexAd[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAd, YandexGetAds>(
        (page) =>
          this.client.post('/ads', {
            method: 'get',
            params: {
              SelectionCriteria: { AdGroupIds: chunk },
              FieldNames: ['Id', 'AdGroupId', 'Type', 'State', 'Status', 'TextAd'],
              Page: page,
            },
          }),
        (result) => result.result.Ads
      )
      allResults.push(...items)
    }

    return allResults
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
    if (dateTo < dateFrom || dateTo > DateTime.now()) {
      throw new Error('API запрос `reports`: неверный диапазон дат.')
    }

    const from = dateFrom.toISODate()!
    const to = dateTo.toISODate()!

    const tsvText = await withYandexRetry(async () => {
      return this.client.post<string>(
        '/reports',
        {
          params: {
            SelectionCriteria: {
              DateFrom: from,
              DateTo: to,
            },
            FieldNames: [
              'Date',
              'AdId',
              'Impressions',
              'Clicks',
              'Cost',
              'Ctr',
              'AvgCpc',
              'AvgCpm',
            ],
            ReportName: `daily_stats_${from}_${to}_${Date.now()}`,
            ReportType: 'AD_PERFORMANCE_REPORT',
            DateRangeType: 'CUSTOM_DATE',
            Format: 'TSV',
            IncludeVAT: 'YES',
            IncludeDiscount: 'NO',
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
    })

    return this.parseTsvReport(tsvText)
  }

  // ---------------------------------------------------------------------------
  // TSV parser
  // ---------------------------------------------------------------------------

  /**
   * Разбирает TSV-ответ от Reports API.
   *
   * Формат (при skipReportHeader=true, skipReportSummary=true):
   *   Строка 1: заголовки колонок (FieldNames)
   *   Строки 2..N: данные
   */
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

        return {
          Date: cols[idx('Date')],
          AdId: Number(cols[idx('AdId')]),
          Impressions: Number(cols[idx('Impressions')]),
          Clicks: Number(cols[idx('Clicks')]),
          Cost: Number(cols[idx('Cost')]),
          Ctr: Number(cols[idx('Ctr')]),
          AvgCpc: avgCpcRaw === '--' || avgCpcRaw === null ? null : Number(avgCpcRaw),
          AvgCpm: Number(cols[idx('AvgCpm')]),
        }
      })
  }
}
