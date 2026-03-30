/**
 * Фабрики для автогенерации данных в тестах Yandex Direct API.
 * Использует детерминированные счётчики вместо random-библиотек
 * чтобы избежать зависимости от @faker-js/faker в dev-deps.
 */

let _idCounter = 100_000_000

function nextId(min = 10_000_000, range = 900_000_000): number {
  return min + (_idCounter++ % range)
}

// ─── Yandex API объекты ────────────────────────────────────────────────────

export interface YandexApiCampaign {
  Id: number
  Name: string
  Type: string
  Status: string
  State: string
}

export interface YandexApiAdGroup {
  Id: number
  Name: string
  CampaignId: number
}

export interface YandexApiAd {
  Id: number
  AdGroupId: number
  Status: string
  State: string
  Type: string
  TextAd: {
    Title: string
    Text: string
  }
}

// ─── Одиночные фабрики ────────────────────────────────────────────────────

export function makeCampaign(overrides: Partial<YandexApiCampaign> = {}): YandexApiCampaign {
  const id = nextId()
  return {
    Id: id,
    Name: `Test Campaign #${id}`,
    Type: 'TEXT_CAMPAIGN',
    Status: 'ACCEPTED',
    State: 'ON',
    ...overrides,
  }
}

export function makeAdGroup(
  campaignId: number,
  overrides: Partial<YandexApiAdGroup> = {}
): YandexApiAdGroup {
  const id = nextId(1_000_000_000)
  return {
    Id: id,
    Name: `Test Group #${id}`,
    CampaignId: campaignId,
    ...overrides,
  }
}

export function makeAd(adGroupId: number, overrides: Partial<YandexApiAd> = {}): YandexApiAd {
  const id = nextId(2_000_000_000)
  return {
    Id: id,
    AdGroupId: adGroupId,
    Status: 'ACCEPTED',
    State: 'ON',
    Type: 'TEXT_AD',
    TextAd: {
      Title: `Title #${id}`.slice(0, 33),
      Text: `Ad text for ad #${id}`.slice(0, 75),
    },
    ...overrides,
  }
}

// ─── DataSet builder ──────────────────────────────────────────────────────

export interface YandexDataSet {
  campaigns: YandexApiCampaign[]
  adGroups: YandexApiAdGroup[]
  ads: YandexApiAd[]
}

/**
 * Генерирует связанный датасет: кампании → группы → объявления.
 * @param campaignsCount      Количество кампаний
 * @param groupsPerCampaign   Групп на каждую кампанию
 * @param adsPerGroup         Объявлений на каждую группу
 */
export function makeDataSet(
  campaignsCount = 3,
  groupsPerCampaign = 2,
  adsPerGroup = 2
): YandexDataSet {
  const campaigns = Array.from({ length: campaignsCount }, () => makeCampaign())

  const adGroups = campaigns.flatMap((c) =>
    Array.from({ length: groupsPerCampaign }, () => makeAdGroup(c.Id))
  )

  const ads = adGroups.flatMap((g) => Array.from({ length: adsPerGroup }, () => makeAd(g.Id)))

  return { campaigns, adGroups, ads }
}

// ─── API Response wrappers ────────────────────────────────────────────────

/** Оборачивает массив в стандартный ответ Yandex API */
export function toApiResponse<T>(key: string, items: T[]): { result: Record<string, T[]> } {
  return { result: { [key]: items } }
}

// ─── Changes API helpers ──────────────────────────────────────────────────

export type ChangesIn = 'SELF' | 'CHILDREN' | 'STAT'

export interface ChangedCampaign {
  CampaignId: number
  ChangesIn: ChangesIn[]
}

export function makeCheckCampaignsResult(opts: {
  timestamp?: string
  modified?: ChangedCampaign[]
  notFoundCampaignIds?: number[]
}) {
  return {
    result: {
      Timestamp: opts.timestamp ?? '2026-03-20T12:00:00Z',
      Modified: opts.modified ?? [],
      NotFound: { CampaignIds: opts.notFoundCampaignIds ?? [] },
    },
  }
}

export function makeCheckCampaignsEmpty(timestamp = '2026-03-20T12:00:00Z') {
  return makeCheckCampaignsResult({ timestamp })
}

/** TSV-ответ reports API (пустой — только заголовок) */
export const EMPTY_REPORTS_TSV = 'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n'

/** Генерирует TSV-строку с данными статистики */
export function makeTsvReport(
  rows: Array<{
    Date: string
    AdId: number
    Impressions: number
    Clicks: number
    Cost: number
  }>
) {
  let tsv = 'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n'
  for (const row of rows) {
    const ctr = row.Impressions > 0 ? (row.Clicks / row.Impressions) * 100 : 0
    const avgCpc = row.Clicks > 0 ? row.Cost / row.Clicks : 0
    tsv += `${row.Date}\t${row.AdId}\t${row.Impressions}\t${row.Clicks}\t${row.Cost}\t${ctr.toFixed(2)}\t${avgCpc.toFixed(0)}\n`
  }
  return tsv
}
