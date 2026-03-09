import axios, { AxiosInstance } from 'axios'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DateTime } from 'luxon'
import { getNow } from '#utils/yandex_dates'
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
      proxy: false, // Отключаем использование системного прокси, так как он (127.0.0.1:10808) отбивает запросы к Яндексу с 503 ошибкой
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept-Language': 'ru',
      },
    })

    // --- TEMPORARY INTERCEPTOR FOR MOCKS ---
    const dumpData = (config: any, data: any, isError: boolean) => {
      try {
        const urlObj = new URL(
          config?.url || '',
          config?.baseURL || 'https://api.direct.yandex.com/json/v5'
        )
        const endpoint = urlObj.pathname.split('/').pop() || 'unknown'

        const mocksDir = path.join(process.cwd(), '.mocks')
        if (!fs.existsSync(mocksDir)) {
          fs.mkdirSync(mocksDir, { recursive: true })
        }

        const timestamp = Date.now()
        const status = isError ? 'error' : 'success'
        let filename = `${timestamp}_${endpoint}_${status}.json`

        let requestData = config?.data
        if (typeof config?.data === 'string') {
          try {
            requestData = JSON.parse(config.data)
          } catch (e) {
            console.error(e)
          }
        }

        const safeHeaders = { ...config?.headers }
        if (safeHeaders['Authorization'] || safeHeaders['authorization']) {
          const authKey = safeHeaders['Authorization'] ? 'Authorization' : 'authorization'
          safeHeaders[authKey] = 'Bearer ***CENSORED***'
        }

        const payload = {
          _request: {
            method: config?.method,
            url: config?.url,
            headers: safeHeaders,
            data: requestData,
            params: config?.params,
          },
          response: data || 'No response data provided',
        }

        let content = ''
        try {
          content = typeof data === 'string' && !isError ? data : JSON.stringify(payload, null, 2)
        } catch (e) {
          // Fallback if there are circular references
          content = String(data)
          console.error(e)
        }

        if (
          !isError &&
          (endpoint === 'reports' || (typeof data === 'string' && data.includes('\t')))
        ) {
          filename = `${timestamp}_${endpoint}.tsv`
          content = data
          fs.writeFileSync(
            path.join(mocksDir, `${timestamp}_${endpoint}_req.json`),
            JSON.stringify(payload._request, null, 2)
          )
        }

        fs.writeFileSync(path.join(mocksDir, filename), content || '{}')
        console.log(`[MockDump] Saved ${filename}`)
      } catch (e) {
        console.error('[MockDump] Failed to dump mock', e)
      }
    }

    this.client.interceptors.response.use(
      (response) => {
        dumpData(response.config, response.data, false)
        return response
      },
      (error) => {
        if (error.response) {
          dumpData(error.config, error.response.data, true)
        } else {
          dumpData(error.config, { message: error.message, code: error.code }, true)
        }
        return Promise.reject(error)
      }
    )
    // ---------------------------------------
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
              FieldNames: ['Id', 'AdGroupId', 'Type', 'State', 'Status'],
              TextAdFieldNames: ['Title', 'Text'],
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
    if (dateTo < dateFrom || dateTo > getNow()) {
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
            FieldNames: ['Date', 'AdId', 'Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc'],
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
  // Changes API
  // ---------------------------------------------------------------------------

  async getServerTimestamp(): Promise<string> {
    const defaultTimestamp = '1970-01-01T00:00:00Z'
    try {
      const result = await this.checkChanges(defaultTimestamp)
      return result.Timestamp
    } catch {
      return getNow().toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'")
    }
  }

  async checkChanges(
    lastTimestamp: string,
    campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = { Timestamp: lastTimestamp }

    if (campaignIds && campaignIds.length > 0) {
      params.FieldNames = ['CampaignsStat']
      // API Limit: max 10,000 campaigns
      params.CampaignIds = campaignIds.slice(0, 10000)
    }

    const result = await withYandexRetry(() =>
      this.client.post('/changes', {
        method: 'check',
        params,
      })
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (result as any).data || result
    return data.result as {
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
