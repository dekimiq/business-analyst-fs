/**
 * @suite integration
 *
 * Тесты ежедневной синхронизации статистики Яндекс.Директ.
 * Группа 3: TC-STAT-01, TC-STAT-02
 */

import { test } from '@japa/runner'
import nock from 'nock'
import { DateTime } from 'luxon'

import Ad from '#models/ad'
import DailyStat from '#models/daily_stat'
import { YandexSyncServiceFacade } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import { ReferenceSyncPhase } from '#models/integration_metadata'

import { cleanDatabase, reloadMeta, setupMeta, YANDEX_BASE, nockChangesEmpty } from './helpers.js'
import { makeCampaign, makeAdGroup, makeAd, makeTsvReport, EMPTY_REPORTS_TSV } from './factories.js'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'

function makeService() {
  const api = new YandexApiClient('test-token')
  const service = new YandexSyncServiceFacade(api)
  return { api, service }
}

test.group('YandexSyncService: Ежедневная статистика (Группа 3)', (group: any) => {
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
  // TC-STAT-01: Обычная загрузка (3-дневный хвост)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-STAT-01: Сохраняет в БД обычный 3-дневный хвост статистики', async ({ assert }) => {
    // 1. Предусловие
    const campaign = await Campaign.create({ source: 'yandex', campaignId: '101', name: 'C1' })
    const group = await AdGroup.create({
      source: 'yandex',
      groupId: '201',
      campaignPk: campaign.id,
      name: 'G1',
    })
    const ad = await Ad.create({ source: 'yandex', adId: '301', groupPk: group.id, title: 'T1' })

    await setupMeta({ referenceSyncPhase: ReferenceSyncPhase.DONE, lastTimestamp: 'ts-initial' })

    // Даты периода (вчера - 3 дня)
    const yesterday = DateTime.now().toUTC().minus({ days: 1 }).toISODate()!
    const from = DateTime.now().toUTC().minus({ days: 3 }).toISODate()!

    // 2. Действие (Mocks)
    nockChangesEmpty(nock, 'ts-new') // syncIncremental

    // Мокаем запрос статистики
    const sampleStat = {
      Date: yesterday,
      AdId: Number(ad.adId),
      Impressions: 500,
      Clicks: 50,
      Cost: 55000000,
    }
    const reportData = makeTsvReport([sampleStat])

    nock(YANDEX_BASE)
      .post(
        '/json/v5/reports',
        (body) =>
          body.params?.SelectionCriteria?.DateFrom === from &&
          body.params?.SelectionCriteria?.DateTo === yesterday
      )
      .reply(200, reportData, { 'Content-Type': 'text/plain' })

    // Заглушка для истории (чтобы не ждал)
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('hist_queue_'))
      .reply(202) // Queued to finish quickly

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const stats = await DailyStat.query().where('adPk', ad.id)
    assert.equal(stats.length, 1)
    assert.equal(stats[0].impressions, 500)
    assert.equal(stats[0].cost, 55) // / 1_000_000
    assert.equal(stats[0].date.toISODate(), yesterday)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-STAT-02: Загрузка по BorderDate
  // ─────────────────────────────────────────────────────────────────────
  test('TC-STAT-02: Загружает статистику с учетом BorderDate и очищает его', async ({ assert }) => {
    // 1. Предусловие
    const campaign = await Campaign.create({ source: 'yandex', campaignId: '101', name: 'C1' })
    const group = await AdGroup.create({
      source: 'yandex',
      groupId: '201',
      campaignPk: campaign.id,
      name: 'G1',
    })
    const ad = await Ad.create({ source: 'yandex', adId: '301', groupPk: group.id, title: 'T1' })

    const borderDateStr = '2026-03-05'
    // dateFrom будет borderDate - 1 = 2026-03-04
    const expectedFrom = '2026-03-04'
    const yesterday = DateTime.now().toUTC().minus({ days: 1 }).toISODate()!

    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts-initial',
      historicalSyncState: { statBorderDate: borderDateStr },
    })

    // 2. Действие (Mocks)
    nockChangesEmpty(nock, 'ts-new') // syncIncremental

    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.SelectionCriteria?.DateFrom === expectedFrom)
      .reply(200, EMPTY_REPORTS_TSV, { 'Content-Type': 'text/plain' })

    // Заглушка для истории
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('hist_queue_'))
      .reply(202)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const meta = await reloadMeta()
    assert.isUndefined(
      (meta.historicalSyncState as any)?.statBorderDate,
      'BorderDate должен быть сброшен'
    )
  })
})
