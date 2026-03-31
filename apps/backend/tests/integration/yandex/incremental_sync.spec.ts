/**
 * @suite integration
 *
 * Тесты инкрементальной синхронизации Яндекс.Директ (Changes API).
 * Группа 2: TC-INC-01, TC-INC-02
 */

import { test } from '@japa/runner'
import nock from 'nock'

import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import { YandexSyncServiceFacade } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'

import { cleanDatabase, reloadMeta, setupMeta, YANDEX_BASE, nockReportsEmpty } from './helpers.js'
import {
  makeCampaign,
  makeAdGroup,
  makeAd,
  toApiResponse,
  makeCheckCampaignsResult,
} from './factories.js'

function makeService() {
  const api = new YandexApiClient('test-token')
  const service = new YandexSyncServiceFacade(api)
  return { api, service }
}

test.group('YandexSyncService: Инкрементальная синхронизация (Часть 1)', (group: any) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/)
    await cleanDatabase()
  })

  group.each.teardown(() => {
    if (!nock.isDone()) {
      const pending = nock.pendingMocks()
      nock.cleanAll()
      throw new Error(`Nock: остались неиспользованные моки:\n  ${pending.join('\n  ')}`)
    }
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-INC-01: Обновление метаданных кампаний (SELF)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-INC-01: Флаг SELF в checkCampaigns обновляет метаданные кампании', async ({
    assert,
  }) => {
    // 1. Предусловие
    const oldCampaign = makeCampaign({ Name: 'Old Name', Status: 'MODERATION' })
    await Campaign.create({
      source: 'yandex',
      campaignId: String(oldCampaign.Id),
      name: oldCampaign.Name,
      status: oldCampaign.Status,
      state: oldCampaign.State,
      type: oldCampaign.Type,
    })

    const lastTs = 'ts-123'
    const newTs = 'ts-456'
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: lastTs,
    })

    // 2. Действие (Mocks)
    // checkCampaigns говорит, что кампания изменилась (SELF)
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(
        200,
        makeCheckCampaignsResult({
          timestamp: newTs,
          modified: [{ CampaignId: oldCampaign.Id, ChangesIn: ['SELF'] }],
        })
      )

    // getCampaigns возвращает новые данные
    const updatedCampaign = { ...oldCampaign, Name: 'New Name', Status: 'ACCEPTED' }
    nock(YANDEX_BASE)
      .post('/json/v5/campaigns')
      .reply(200, toApiResponse('Campaigns', [updatedCampaign]))

    // Заглушки для статистики и истории (единая персистентная заглушка)
    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const dbCampaign = await Campaign.query()
      .where('campaignId', String(oldCampaign.Id))
      .firstOrFail()
    assert.equal(dbCampaign.name, 'New Name')
    assert.equal(dbCampaign.status, 'ACCEPTED')

    const meta = await reloadMeta()
    assert.equal(meta.lastTimestamp, newTs)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-INC-02: Изменения в группах и объявлениях (CHILDREN)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-INC-02: CHILDREN изменения создают новые группы и объявления', async ({ assert }) => {
    // 1. Предусловие
    const campaign = makeCampaign()
    const c = await Campaign.create({
      source: 'yandex',
      campaignId: String(campaign.Id),
      name: campaign.Name,
    })

    const lastTs = 'ts-start'
    const nextTs = 'ts-end'
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: lastTs,
    })

    // 2. Действие (Mocks)
    // checkCampaigns -> CHILDREN
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(
        200,
        makeCheckCampaignsResult({
          timestamp: nextTs,
          modified: [{ CampaignId: campaign.Id, ChangesIn: ['CHILDREN'] }],
        })
      )

    // api.check -> Modified AdGroup 201, Ad 301
    const adGroupId = 201
    const adId = 301
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, {
        result: {
          Modified: {
            AdGroupIds: [adGroupId],
            AdIds: [adId],
          },
        },
      })

    // getAdGroupsByIds
    const groupData = makeAdGroup(campaign.Id, { Id: adGroupId, Name: 'Incremental Group' })
    nock(YANDEX_BASE)
      .post('/json/v5/adgroups')
      .reply(200, toApiResponse('AdGroups', [groupData]))

    // getAdsByIds
    const adData = makeAd(adGroupId, { Id: adId, TextAd: { Title: 'Inc Title', Text: 'Inc Text' } })
    nock(YANDEX_BASE)
      .post('/json/v5/ads')
      .reply(200, toApiResponse('Ads', [adData]))

    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const dbGroup = await AdGroup.query().where('groupId', String(adGroupId)).firstOrFail()
    assert.equal(dbGroup.name, 'Incremental Group')
    assert.equal(dbGroup.campaignPk, c.id)

    const dbAd = await Ad.query().where('adId', String(adId)).firstOrFail()
    assert.equal(dbAd.title, 'Inc Title')
    assert.equal(dbAd.groupPk, dbGroup.id)

    const meta = await reloadMeta()
    assert.equal(meta.lastTimestamp, nextTs)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-INC-03: Удаление кампаний (NotFound)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-INC-03: NotFound в checkCampaigns помечает кампанию как удаленную', async ({
    assert,
  }) => {
    // 1. Предусловие
    const campaignId = '777'
    await Campaign.create({ source: 'yandex', campaignId, name: 'To Delete' })

    await setupMeta({ referenceSyncPhase: ReferenceSyncPhase.DONE, lastTimestamp: 'old-ts' })

    // 2. Действие
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(
        200,
        makeCheckCampaignsResult({
          timestamp: 'new-ts',
          notFoundCampaignIds: [Number(campaignId)],
        })
      )

    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const dbCampaign = await Campaign.query().where('campaignId', campaignId).firstOrFail()
    assert.equal(
      dbCampaign.status,
      'DELETED',
      'Кампания должна быть помечена как удаленная (status=DELETED)'
    )
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-INC-04: Флаг STAT и BorderDate
  // ─────────────────────────────────────────────────────────────────────
  test('TC-INC-04: Флаг STAT обновляет statBorderDate в метаданных', async ({ assert }) => {
    // 1. Предусловие
    const campaignId = 555
    await Campaign.create({
      source: 'yandex',
      campaignId: String(campaignId),
      name: 'Stat Campaign',
    })

    await setupMeta({ referenceSyncPhase: ReferenceSyncPhase.DONE, lastTimestamp: 'ts-1' })

    // 2. Действие
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(
        200,
        makeCheckCampaignsResult({
          timestamp: 'ts-2',
          modified: [{ CampaignId: campaignId, ChangesIn: ['STAT'] }],
        })
      )

    // check call for stats
    const borderDate = '2026-03-25'
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, {
        result: {
          Timestamp: 'ts-2',
          CampaignsStat: [{ CampaignId: campaignId, BorderDate: borderDate }],
        },
      })

    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    // После завершения всего цикла sync(), statBorderDate должен быть сброшен,
    // так как syncDailyStats его "потребил" и очистил.
    const meta = await reloadMeta()
    assert.isUndefined(
      (meta.historicalSyncState as any)?.statBorderDate,
      'statBorderDate должен быть очищен после синхронизации'
    )
  })
})
