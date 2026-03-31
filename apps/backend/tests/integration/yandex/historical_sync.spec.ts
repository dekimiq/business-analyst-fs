/**
 * @suite integration
 *
 * Тесты исторической синхронизации Яндекс.Директ.
 * Группа 4: TC-HIST-01, TC-HIST-02 (instant/state), TC-HIST-03
 */

import { test } from '@japa/runner'
import nock from 'nock'
import { DateTime } from 'luxon'

import Ad from '#models/ad'
import DailyStat from '#models/daily_stat'
import { YandexSyncServiceFacade } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import { ReferenceSyncPhase } from '#models/integration_metadata'

import {
  cleanDatabase,
  reloadMeta,
  setupMeta,
  YANDEX_BASE,
  nockReportsEmpty,
  nockChangesEmpty,
} from './helpers.js'
import { makeCampaign, makeAdGroup, makeAd, makeTsvReport, EMPTY_REPORTS_TSV } from './factories.js'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'

function makeService() {
  const api = new YandexApiClient('test-token')
  const service = new YandexSyncServiceFacade(api)
  return { api, service }
}

test.group('YandexSyncService: Историческая синхронизация (Группа 4)', (group: any) => {
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
  // TC-HIST-01: Первый запуск — постановка в оффлайн очередь
  // ─────────────────────────────────────────────────────────────────────
  test('TC-HIST-01: Переходит в состояние queued, если Яндекс вернул 202', async ({ assert }) => {
    // 1. Предусловие
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts',
      syncStartDate: DateTime.now().minus({ days: 60 }).startOf('day'),
    })

    // 2. Действия
    nockChangesEmpty(nock)

    // Daily stats (empty)
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('dl_'))
      .reply(200, EMPTY_REPORTS_TSV, { 'Content-Type': 'text/plain' })

    // История (202 Accepted)
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('hist_queue_'))
      .reply(202)

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const meta = await reloadMeta()
    assert.equal((meta.historicalSyncState as any)?.status, 'queued')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-HIST-02-instant: Моментальный ответ API Отчетов (бывший BUG-01)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-HIST-02-instant: Данные сохраняются сразу, если Яндекс вернул 200 OK на заказ отчета', async ({
    assert,
  }) => {
    // 1. Предусловие
    const campaign = await Campaign.create({ source: 'yandex', campaignId: '101', name: 'C1' })
    const group = await AdGroup.create({
      source: 'yandex',
      groupId: '201',
      campaignPk: campaign.id,
      name: 'G1',
    })
    const ad = await Ad.create({ source: 'yandex', adId: '301', groupPk: group.id, title: 'T1' })

    const startDate = DateTime.now().minus({ days: 10 }).startOf('day')
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts-initial',
      syncStartDate: startDate,
    })

    // 2. Действие (Mocks)
    nockChangesEmpty(nock, 'ts-new')

    // Daily stats
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('dl_'))
      .reply(200, EMPTY_REPORTS_TSV, { 'Content-Type': 'text/plain' })

    // История (200 OK)
    const histData = makeTsvReport([
      {
        Date: startDate.toISODate()!,
        AdId: Number(ad.adId),
        Impressions: 100,
        Clicks: 10,
        Cost: 10000000,
      },
    ])
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('hist_queue_'))
      .reply(200, histData, { 'Content-Type': 'text/plain' })

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const stats = await DailyStat.query().where('adPk', ad.id)
    assert.equal(stats.length, 1)

    const meta = await reloadMeta()
    assert.isNull(meta.historicalSyncState)
    assert.equal(meta.historicalSyncedUntil?.toISODate(), startDate.toISODate())
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-HIST-02-state: Завершение отчета из состояния queued
  // ─────────────────────────────────────────────────────────────────────
  test('TC-HIST-02-state: Успешное получение отчета из состояния queued', async ({ assert }) => {
    // 1. Предусловие
    const ad = await Ad.create({ source: 'yandex', adId: '301', title: 'T1' })
    const dateFrom = '2026-03-01'
    const reportName = 'existing_report'

    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts',
      historicalSyncState: { status: 'queued', reportName, dateFrom, dateTo: '2026-03-10' },
    })

    // 2. Действие
    nockChangesEmpty(nock)

    // Daily
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('dl_'))
      .reply(200, EMPTY_REPORTS_TSV, { 'Content-Type': 'text/plain' })

    // История (запрос по существующему имени)
    const histData = makeTsvReport([
      { Date: dateFrom, AdId: 301, Impressions: 50, Clicks: 5, Cost: 5000000 },
    ])
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith(reportName))
      .reply(200, histData, { 'Content-Type': 'text/plain' })

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const stats = await DailyStat.query().where('adPk', ad.id)
    assert.equal(stats.length, 1)

    const meta = await reloadMeta()
    assert.isNull(meta.historicalSyncState)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-HIST-03: Уменьшение chunkSize при ошибке Unpossible
  // ─────────────────────────────────────────────────────────────────────
  test('TC-HIST-03: Уменьшает chunkSize при ошибке ApiReportUnpossible', async ({ assert }) => {
    // 1. Предусловие
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts',
      syncStartDate: DateTime.now().minus({ days: 90 }).startOf('day'),
      historicalSyncState: { chunkSize: 30 },
    })

    // 2. Действие
    nockChangesEmpty(nock)

    // Daily
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('dl_'))
      .reply(200, EMPTY_REPORTS_TSV, { 'Content-Type': 'text/plain' })

    // История (Error 8312)
    nock(YANDEX_BASE)
      .post('/json/v5/reports', (body) => body.params?.ReportName?.startsWith('hist_queue_'))
      .reply(200, { error: { error_code: 8312, error_string: 'Report too large' } })

    const { service } = makeService()
    await service.sync()

    // 3. Ожидание
    const meta = await reloadMeta()
    assert.equal((meta.historicalSyncState as any)?.chunkSize, 15)
    assert.equal((meta.historicalSyncState as any)?.status, 'error')
  })
})
