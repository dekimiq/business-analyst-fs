// ---------------------------------------------------------------------------
// Paged responses (campaigns / ad_groups / ads — JSON API)
// ---------------------------------------------------------------------------

interface YandexPagedResponse<TCollection> {
  result: TCollection & {
    LimitedBy?: number
  }
}

export interface YandexCampaign {
  Id: number
  Name: string
  Type?: string
  Status?: string
  State?: string
}

export interface YandexAdGroup {
  Id: number
  Name: string
  CampaignId: number
}

export interface YandexAd {
  Id: number
  AdGroupId: number
  Type: string
  State: string
  Status: string
  TextAd?: {
    Title: string
    Text: string
  }
}

export type YandexGetCampaigns = YandexPagedResponse<{ Campaigns: YandexCampaign[] }>
export type YandexGetAdGroups = YandexPagedResponse<{ AdGroups: YandexAdGroup[] }>
export type YandexGetAds = YandexPagedResponse<{ Ads: YandexAd[] }>

// ---------------------------------------------------------------------------
// Reports API (AD_PERFORMANCE_REPORT — TSV parsed into this shape)
// ---------------------------------------------------------------------------

/**
 * Одна строка из TSV-отчёта Яндекс.Директ.
 *
 * Cost, AvgCpc, AvgCpm приходят из API в микронах (1 рубль = 1_000_000 единиц),
 * если в запросе выставлен заголовок `returnMoneyInMicros: true`.
 * Конвертацию делаем при сохранении в БД.
 */
export interface YandexDailyStat {
  Date: string // 'YYYY-MM-DD'
  AdId: number
  Impressions: number
  Clicks: number
  /** Стоимость в микронах */
  Cost: number
  /** CTR в процентах (например, 5.55) */
  Ctr: number
  /** Средняя цена клика в микронах; null если кликов не было */
  AvgCpc: number | null
  /** Средняя цена тысячи показов в микронах */
  AvgCpm: number
}
