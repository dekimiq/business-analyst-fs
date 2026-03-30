import db from '@adonisjs/lucid/services/db'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import type { YandexSyncContext } from './yandex_sync_context.js'
import type { YandexCampaignChange } from '#types/yandex'

const BATCH_SIZE = 500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = map.get(k) ?? []
    group.push(item)
    map.set(k, group)
  }
  return map
}

// ---------------------------------------------------------------------------
// Public entry point: вызывается из index.ts ПОСЛЕ структурного синка
// ---------------------------------------------------------------------------

/**
 * Инкрементальное обновление структуры и статистики за один цикл.
 * Использует Changes API вместо полной выгрузки — запрашивает только изменённые объекты.
 *
 * Алгоритм (по docs/PLAN_FIX_SYNC.md):
 * 1. checkCampaigns → разбиваем на SELF / CHILDREN / STAT
 * 2. SELF  → обновляем только изменённые кампании
 * 3. CHILDREN → check(AdGroupIds, AdIds) → updateOrCreate только для Modified, деактивируем NotFound
 * 4. STAT  → собираем min(BorderDate) и скачиваем статистику
 * 5. newTimestamp фиксируется ТОЛЬКО после полного успеха
 */
export async function syncIncremental(ctx: YandexSyncContext): Promise<void> {
  const { meta, api, logger, source } = ctx

  if (!meta.lastTimestamp) {
    logger.info('[Incremental] lastTimestamp отсутствует — пропускаем инкрементальный режим.')
    return
  }

  logger.info(`[Incremental] Проверяем изменения с Timestamp: ${meta.lastTimestamp}`)

  const checkResult = await api.checkCampaigns(meta.lastTimestamp)
  const newTimestamp = checkResult.Timestamp

  const modified = checkResult.Modified ?? []
  const notFoundCampaignIds = checkResult.NotFound?.CampaignIds ?? []

  logger.info(
    `[Incremental] checkCampaigns: ${modified.length} изменённых кампаний, ${notFoundCampaignIds.length} не найденных.`
  )

  if (notFoundCampaignIds.length > 0) {
    await deactivateCampaigns(source, notFoundCampaignIds, logger)
  }

  if (modified.length === 0) {
    logger.info('[Incremental] Изменений нет. Пропускаем.')
    meta.lastTimestamp = newTimestamp
    await meta.save()
    return
  }

  // Группируем по флагам ChangesIn
  const selfIds = modified.filter((c) => c.ChangesIn.includes('SELF')).map((c) => c.CampaignId)
  const childrenIds = modified
    .filter((c) => c.ChangesIn.includes('CHILDREN'))
    .map((c) => c.CampaignId)
  const statIds = modified.filter((c) => c.ChangesIn.includes('STAT')).map((c) => c.CampaignId)

  logger.info(
    `[Incremental] SELF: ${selfIds.length}, CHILDREN: ${childrenIds.length}, STAT: ${statIds.length}`
  )

  // Step 2: SELF — обновить метаданные изменённых кампаний
  if (selfIds.length > 0) {
    await processSelfChanges(ctx, selfIds)
  }

  // Step 3: CHILDREN — обновить изменённые группы и объявления
  if (childrenIds.length > 0) {
    await processChildrenChanges(ctx, childrenIds)
  }

  // Step 4: STAT — корректировка статистики (возвращает borderDate для последующего syncDailyStats)
  const borderDate = statIds.length > 0 ? await processStatChanges(ctx, statIds) : undefined

  // Step 5: Зафиксировать timestamp только после полного успеха
  meta.lastTimestamp = newTimestamp
  await meta.save()

  logger.info(
    `[Incremental] Готово. Новый timestamp: ${newTimestamp}. borderDate для статистики: ${borderDate ?? 'нет'}`
  )

  return
}

// ---------------------------------------------------------------------------
// Step 2: SELF
// ---------------------------------------------------------------------------

async function processSelfChanges(ctx: YandexSyncContext, campaignIds: number[]): Promise<void> {
  const { api, logger, source } = ctx
  logger.info(`[Incremental/SELF] Обновляем ${campaignIds.length} кампаний...`)

  const campaigns = await api.getCampaigns(campaignIds)

  await db.transaction(async (trx) => {
    for (const c of campaigns) {
      await Campaign.updateOrCreate(
        { source, campaignId: String(c.Id) },
        { name: c.Name, type: c.Type ?? null, status: c.Status ?? null, state: c.State ?? null },
        { client: trx }
      )
    }
  })

  logger.info(`[Incremental/SELF] Обновлено ${campaigns.length} кампаний.`)
}

// ---------------------------------------------------------------------------
// Step 3: CHILDREN
// ---------------------------------------------------------------------------

async function processChildrenChanges(
  ctx: YandexSyncContext,
  campaignIds: number[]
): Promise<void> {
  const { api, logger, source } = ctx
  logger.info(`[Incremental/CHILDREN] check для ${campaignIds.length} кампаний...`)

  const checkResult = await api.check({
    timestamp: ctx.meta.lastTimestamp!,
    campaignIds,
    fieldNames: ['AdGroupIds', 'AdIds'],
  })

  const modifiedGroupIds = checkResult.Modified?.AdGroupIds ?? []
  const modifiedAdIds = checkResult.Modified?.AdIds ?? []
  const notFoundGroupIds = checkResult.NotFound?.AdGroupIds ?? []
  const notFoundAdIds = checkResult.NotFound?.AdIds ?? []

  logger.info(
    `[Incremental/CHILDREN] Групп изменено: ${modifiedGroupIds.length}, объявлений: ${modifiedAdIds.length}. ` +
      `Не найдено групп: ${notFoundGroupIds.length}, объявлений: ${notFoundAdIds.length}.`
  )

  if (modifiedGroupIds.length > 0) {
    await updateAdGroups(ctx, modifiedGroupIds)
  }

  if (notFoundGroupIds.length > 0) {
    await deactivateAdGroups(source, notFoundGroupIds, logger)
  }

  if (modifiedAdIds.length > 0) {
    await updateAds(ctx, modifiedAdIds)
  }

  if (notFoundAdIds.length > 0) {
    await deactivateAds(source, notFoundAdIds, logger)
  }
}

async function updateAdGroups(ctx: YandexSyncContext, groupIds: number[]): Promise<void> {
  const { api, logger, source } = ctx

  const groups = await api.getAdGroupsByIds(groupIds)
  if (groups.length === 0) return

  const campaignApiIds = Array.from(new Set(groups.map((g) => String(g.CampaignId))))
  const campaignRecords = await Campaign.query()
    .whereIn('campaignId', campaignApiIds)
    .where('source', source)
  const campaignIdMap = new Map(campaignRecords.map((c) => [String(c.campaignId), c.id]))

  const chunks = splitIntoChunks(groups, BATCH_SIZE)
  for (const chunk of chunks) {
    await db.transaction(async (trx) => {
      for (const g of chunk) {
        const internalCampaignPk = campaignIdMap.get(String(g.CampaignId))
        if (!internalCampaignPk) continue

        await AdGroup.updateOrCreate(
          { source, groupId: String(g.Id) },
          { name: g.Name, campaignPk: internalCampaignPk },
          { client: trx }
        )
      }
    })
  }

  logger.info(`[Incremental/CHILDREN] Обновлено ${groups.length} групп.`)
}

async function updateAds(ctx: YandexSyncContext, adIds: number[]): Promise<void> {
  const { api, logger, source } = ctx

  const ads = await api.getAdsByIds(adIds)
  if (ads.length === 0) return

  const groupApiIds = Array.from(new Set(ads.map((a) => String(a.AdGroupId))))
  const groupRecords = await AdGroup.query().whereIn('groupId', groupApiIds).where('source', source)
  const groupIdMap = new Map(groupRecords.map((g) => [String(g.groupId), g.id]))

  const chunks = splitIntoChunks(ads, BATCH_SIZE)
  for (const chunk of chunks) {
    await db.transaction(async (trx) => {
      for (const a of chunk) {
        const internalGroupPk = groupIdMap.get(String(a.AdGroupId))
        if (!internalGroupPk) continue

        await Ad.updateOrCreate(
          { source, adId: String(a.Id) },
          {
            groupPk: internalGroupPk,
            title: a.TextAd?.Title ?? null,
            text: a.TextAd?.Text ?? null,
          },
          { client: trx }
        )
      }
    })
  }

  logger.info(`[Incremental/CHILDREN] Обновлено ${ads.length} объявлений.`)
}

// ---------------------------------------------------------------------------
// Step 4: STAT — возвращает минимальный BorderDate для последующего скачивания статистики
// ---------------------------------------------------------------------------

async function processStatChanges(
  ctx: YandexSyncContext,
  campaignIds: number[]
): Promise<string | undefined> {
  const { api, logger } = ctx
  logger.info(`[Incremental/STAT] check для ${campaignIds.length} кампаний...`)

  const checkResult = await api.check({
    timestamp: ctx.meta.lastTimestamp!,
    campaignIds,
    fieldNames: ['CampaignsStat'],
  })

  const borderDates = (checkResult.CampaignsStat ?? [])
    .map((s) => s.BorderDate)
    .filter((d): d is string => !!d)
    .sort()

  if (borderDates.length === 0) {
    logger.info('[Incremental/STAT] BorderDate не получен — статистика актуальна.')
    return undefined
  }

  const minBorderDate = borderDates[0]
  logger.info(
    `[Incremental/STAT] Минимальный BorderDate: ${minBorderDate}. Статистику нужно перекачать.`
  )

  ctx.meta.historicalSyncState = {
    ...(ctx.meta.historicalSyncState ?? {}),
    statBorderDate: minBorderDate,
  }
  await ctx.meta.save()

  return minBorderDate
}

// ---------------------------------------------------------------------------
// Deactivation helpers — мягкое удаление (status = 'DELETED')
// ---------------------------------------------------------------------------

async function deactivateCampaigns(
  source: string,
  campaignIds: number[],
  logger: { warn: (msg: string) => void }
): Promise<void> {
  const ids = campaignIds.map(String)
  await Campaign.query()
    .whereIn('campaignId', ids)
    .where('source', source)
    .update({ status: 'DELETED' })
  logger.warn(`[Incremental] Деактивировано ${ids.length} кампаний (NotFound): ${ids.join(', ')}`)
}

async function deactivateAdGroups(
  source: string,
  groupIds: number[],
  logger: { warn: (msg: string) => void }
): Promise<void> {
  const ids = groupIds.map(String)
  await AdGroup.query()
    .whereIn('groupId', ids)
    .where('source', source)
    .update({ status: 'DELETED' })
  logger.warn(`[Incremental/CHILDREN] Деактивировано ${ids.length} групп (NotFound).`)
}

async function deactivateAds(
  source: string,
  adIds: number[],
  logger: { warn: (msg: string) => void }
): Promise<void> {
  const ids = adIds.map(String)
  await Ad.query().whereIn('adId', ids).where('source', source).update({ status: 'DELETED' })
  logger.warn(`[Incremental/CHILDREN] Деактивировано ${ids.length} объявлений (NotFound).`)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function splitIntoChunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}
