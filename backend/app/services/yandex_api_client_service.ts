import axios, { AxiosInstance } from 'axios'
import { DateTime } from 'luxon'
import env from '#start/env'
import { withYandexRetry } from '../utils/yandex_retry.js'
import {
  YandexCampaign,
  YandexGetCampaigns,
  YandexAdGroup,
  YandexGetAdGroups,
  YandexAd,
  YandexGetAds,
} from '../types/yandex.js'
import { chunkArray } from '../utils/universal.js'

export default class YandexApiClientService {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api-sandbox.direct.yandex.com/json/v5',
      headers: {
        'Authorization': `Bearer ${env.get('YANDEX_DIRECT_TOKEN')}`,
        'Accept-Language': 'ru',
        // 'Client-Login': env.get('YANDEX_CLIENT_LOGIN'), // Если агентский аккаунт
      },
    })
  }

  private async fetchAllPages<TItem, TResult extends { result: { LimitedBy?: number } }>(
    fetchPage: (page: {
      Limit: number
      Offset: number
    }) => Promise<{ status: number; data: TResult }>,
    extractItems: (result: TResult) => TItem[]
  ): Promise<TItem[]> {
    const all: TItem[] = []
    let offset = 0
    const limit = 10_000

    while (true) {
      const result: TResult = await withYandexRetry(() =>
        fetchPage({ Limit: limit, Offset: offset })
      )
      all.push(...extractItems(result))
      if (!result.result.LimitedBy) break
      offset = result.result.LimitedBy
    }

    return all
  }

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

  async getAdGroups(campaignIds: number[]) {
    if (campaignIds.length === 0) {
      throw new Error('API запрос:`/adgroups`. Список id кампаний не может быть пустой.')
    }

    const apiLimitIds = 10
    const allResults: YandexAdGroup[] = []

    const chunks = chunkArray(campaignIds, apiLimitIds)

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAdGroup, YandexGetAdGroups>(
        (page) =>
          this.client.post('/adgroups', {
            method: 'get',
            params: {
              SelectionCriteria: {
                CampaignIds: chunk,
              },
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

  async getAds(adGroupIds: number[]) {
    if (adGroupIds.length === 0) {
      throw new Error('API запрос:`/ads`. Список id кампаний не может быть пустой.')
    }

    const apiLimitIds = 1_000
    const allResults: YandexAd[] = []

    const chunks = chunkArray(adGroupIds, apiLimitIds)

    for (const chunk of chunks) {
      const items = await this.fetchAllPages<YandexAd, YandexGetAds>(
        (page) =>
          this.client.post('/ads', {
            method: 'get',
            params: {
              SelectionCriteria: {
                AdGroupIds: chunk,
              },
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

  async getDailyStats({ dateFrom, dateTo }: { dateFrom: DateTime; dateTo: DateTime }) {
    if (!dateFrom.isValid || !dateTo.isValid) {
      throw new Error('API запрос:`/reports`. Некорректная дата.')
    }

    if (dateTo < dateFrom || dateTo > DateTime.now()) {
      throw new Error('API запрос:`/reports`. Неверный диапозон дат.')
    }

    const from = dateFrom.toISODate()
    const to = dateTo.toISODate()

    return withYandexRetry(async () => {
      return this.client.post('/reports', {
        params: {
          SelectionCriteria: {
            DateFrom: from,
            DateTo: to,
          },
          FieldNames: ['Date', 'AdId', 'Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc', 'AvgCpm'],
          ReportName: `daily_stats_${from}_${to}`,
          ReportType: 'AD_PERFORMANCE_REPORT',
          DateRangeType: 'CUSTOM_DATE',
          Format: 'TSV',
          IncludeVAT: 'YES',
          IncludeDiscount: 'NO',
        },
      })
    })
  }
}
