import axios, { type AxiosInstance } from 'axios'
import { type DateTime } from 'luxon'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import type {
  YandexCampaign,
  YandexGetCampaigns,
  YandexAdGroup,
  YandexGetAdGroups,
  YandexAd,
  YandexGetAds,
  YandexDailyStat,
  YandexCheckCampaignsResult,
  YandexCheckResult,
  ChangeFieldName,
} from '#types/yandex'
import { YandexRetryService } from '#utils/yandex_retry'

/**
 * Разбивает массив на чанки заданного размера.
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
 */
export class YandexApiClient implements IYandexApiClient {
  private readonly client: AxiosInstance

  constructor(token: string) {
    this.client = axios.create({
      baseURL: 'https://api.direct.yandex.com/json/v5/',
      adapter: 'http', // Принудительно для работы Nock в Node 20+
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
  // Campaigns
  // ---------------------------------------------------------------------------

  /**
   * Получить кампании. Если передан массив ids — фильтруем по ним (инкрементальное обновление).
   */
  async getCampaigns(ids?: number[]): Promise<YandexCampaign[]> {
    const selectionCriteria = ids && ids.length > 0 ? { Ids: ids } : {}

    return this.fetchAllPages<YandexCampaign, YandexGetCampaigns>(
      (page) =>
        this.client.post('campaigns', {
          method: 'get',
          params: {
            SelectionCriteria: selectionCriteria,
            FieldNames: ['Id', 'Name', 'Type', 'Status', 'State'],
            Page: page,
          },
        }),
      (result) => result.result.Campaigns
    )
  }

  // ---------------------------------------------------------------------------
  // AdGroups
  // ---------------------------------------------------------------------------

  /**
   * Получить группы по ID кампаний (полная синхронизация кампании).
   * Чисто фильтруется по CampaignIds.
   */
  async getAdGroups(campaignIds: number[]): Promise<YandexAdGroup[]> {
    if (campaignIds.length === 0) {
      throw new Error('API запрос `adgroups`: список CampaignIds не может быть пустым.')
    }

    const chunks = chunkArray(campaignIds, 1_000)
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

  /**
   * Получить группы по конкретным ID (инкрементальное обновление changed groups).
   */
  async getAdGroupsByIds(ids: number[]): Promise<YandexAdGroup[]> {
    if (ids.length === 0) return []

    const chunks = chunkArray(ids, 10_000)
    const all: YandexAdGroup[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAdGroup, YandexGetAdGroups>(
        (page) =>
          this.client.post('adgroups', {
            method: 'get',
            params: {
              SelectionCriteria: { Ids: chunk },
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

  // ---------------------------------------------------------------------------
  // Ads
  // ---------------------------------------------------------------------------

  /**
   * Получить объявления по ID групп (полная синхронизация группы).
   */
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

  /**
   * Получить объявления по конкретным ID (инкрементальное обновление changed ads).
   */
  async getAdsByIds(ids: number[]): Promise<YandexAd[]> {
    if (ids.length === 0) return []

    const chunks = chunkArray(ids, 10_000)
    const all: YandexAd[] = []

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAd, YandexGetAds>(
        (page) =>
          this.client.post('ads', {
            method: 'get',
            params: {
              SelectionCriteria: { Ids: chunk },
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
    reportName,
  }: {
    dateFrom: DateTime
    dateTo: DateTime
    reportName?: string
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
              ReportName: reportName
                ? `${reportName}_${offset}`
                : `dl_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}_${offset}`,
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
    const result = await this.checkCampaigns('1970-01-01T00:00:00Z')
    return result.Timestamp
  }

  /**
   * Changes.checkCampaigns — получить список кампаний с флагами изменений.
   * Возвращает массив с`ChangesIn: ['SELF', 'CHILDREN', 'STAT']`.
   */
  async checkCampaigns(timestamp: string): Promise<YandexCheckCampaignsResult> {
    const response = await YandexRetryService.call(() =>
      this.client.post('changes', {
        method: 'checkCampaigns',
        params: { Timestamp: timestamp },
      })
    )

    return response.data.result as YandexCheckCampaignsResult
  }

  /**
   * Changes.check — универсальный метод для получения изменений по списку ID кампаний.
   *
   * Лимиты (по документации Яндекс.Директ):
   *  - CampaignIds: до 3 000 элементов
   *  - AdGroupIds:  до 10 000 элементов
   *  - AdIds:       до 50 000 элементов
   *
   * Параметры CampaignIds, AdGroupIds, AdIds — взаимоисключающие в одном запросе.
   * Собирает данные чанками и рекурсивно добирает Unprocessed.
   */
  async check(params: {
    timestamp: string
    campaignIds: number[]
    fieldNames: ChangeFieldName[]
  }): Promise<YandexCheckResult> {
    const { timestamp, campaignIds, fieldNames } = params

    if (campaignIds.length === 0) {
      return { Timestamp: timestamp }
    }

    const chunks = chunkArray(campaignIds, 3_000)
    const accumulated: YandexCheckResult = { Timestamp: timestamp }

    for (const chunk of chunks) {
      const response = await YandexRetryService.call(() =>
        this.client.post('changes', {
          method: 'check',
          params: {
            Timestamp: timestamp,
            CampaignIds: chunk,
            FieldNames: fieldNames,
          },
        })
      )

      const result = response.data.result as YandexCheckResult
      accumulated.Timestamp = result.Timestamp

      if (result.Modified) {
        accumulated.Modified = accumulated.Modified ?? {}
        for (const [key, ids] of Object.entries(result.Modified) as [string, number[]][]) {
          const k = key as keyof typeof accumulated.Modified
          accumulated.Modified[k] = [...(accumulated.Modified[k] ?? []), ...ids]
        }
      }

      if (result.NotFound) {
        accumulated.NotFound = accumulated.NotFound ?? {}
        for (const [key, ids] of Object.entries(result.NotFound) as [string, number[]][]) {
          const k = key as keyof typeof accumulated.NotFound
          accumulated.NotFound[k] = [...(accumulated.NotFound[k] ?? []), ...ids]
        }
      }

      if (result.CampaignsStat) {
        accumulated.CampaignsStat = [...(accumulated.CampaignsStat ?? []), ...result.CampaignsStat]
      }

      if (result.Unprocessed?.CampaignIds && result.Unprocessed.CampaignIds.length > 0) {
        const retried = await this.check({
          timestamp: result.Timestamp,
          campaignIds: result.Unprocessed.CampaignIds,
          fieldNames,
        })

        if (retried.Modified) {
          accumulated.Modified = accumulated.Modified ?? {}
          for (const [key, ids] of Object.entries(retried.Modified) as [string, number[]][]) {
            const k = key as keyof typeof accumulated.Modified
            accumulated.Modified[k] = [...(accumulated.Modified[k] ?? []), ...ids]
          }
        }
      }
    }

    return accumulated
  }

  /**
   * @deprecated Используй checkCampaigns / check напрямую.
   */
  async checkChanges(
    lastTimestamp: string,
    campaignIds?: number[]
  ): Promise<{
    Timestamp: string
    CampaignsStat?: Array<{ CampaignId: number; BorderDate?: string }>
  }> {
    if (campaignIds && campaignIds.length > 0) {
      return this.check({
        timestamp: lastTimestamp,
        campaignIds,
        fieldNames: ['CampaignsStat'],
      })
    }

    const result = await this.checkCampaigns(lastTimestamp)
    return { Timestamp: result.Timestamp }
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
