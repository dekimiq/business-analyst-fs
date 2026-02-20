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
  TextAd: {
    Title: string
    Text: string
  }
}

export type YandexGetCampaigns = YandexPagedResponse<{ Campaigns: YandexCampaign[] }>
export type YandexGetAdGroups = YandexPagedResponse<{ AdGroups: YandexAdGroup[] }>
export type YandexGetAds = YandexPagedResponse<{ Ads: YandexAd[] }>
