/**
 * @suite integration
 *
 * Тесты механизма возобновляемости структурных фаз Яндекс.Директ синхронизации.
 *
 * Стейт-машина:
 *   TIMESTAMP → CAMPAIGNS → AD_GROUPS → ADS → DONE
 *
 * Каждый тест взаимодействует с реальной тестовой БД через Lucid ORM.
 * HTTP-запросы перехватываются через nock (нет реальных сетевых обращений).
 */

import { test } from '@japa/runner'
import nock from 'nock'
import { DateTime } from 'luxon'

import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import { YandexSyncServiceFacade } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import {
  MetaTokenUnavailableError,
  MetaSyncStartDateUnavailableError,
} from '#exceptions/sync_exceptions'

import {
  cleanDatabase,
  reloadMeta,
  setupMeta,
  YANDEX_BASE,
  nockReportsEmpty,
  nockChangesEmpty,
} from './helpers.js'
import { makeDataSet, toApiResponse, EMPTY_REPORTS_TSV } from './factories.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeService() {
  const api = new YandexApiClient('test-token')
  const service = new YandexSyncServiceFacade(api)
  return { api, service }
}

async function countAll() {
  const [campaigns, adGroups, ads] = await Promise.all([
    Campaign.query().where('source', 'yandex').count('* as total'),
    AdGroup.query().where('source', 'yandex').count('* as total'),
    Ad.query().where('source', 'yandex').count('* as total'),
  ])
  return {
    campaigns: Number(campaigns[0].$extras.total),
    adGroups: Number(adGroups[0].$extras.total),
    ads: Number(ads[0].$extras.total),
  }
}

// ─── Тесты ────────────────────────────────────────────────────────────────

test.group('YandexSyncService: Возобновляемость структурных фаз', (group: any) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/)
    await cleanDatabase()
  })

  group.each.teardown(() => {
    // Убеждаемся что все ожидаемые моки были вызваны
    if (!nock.isDone()) {
      const pending = nock.pendingMocks()
      nock.cleanAll()
      throw new Error(`Nock: остались неиспользованные моки:\n  ${pending.join('\n  ')}`)
    }
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-01: Полный путь без ошибок — фаза достигает DONE
  // ─────────────────────────────────────────────────────────────────────
  test('TC-01: Полный путь без ошибок — phase достигает DONE и все данные сохранены', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(3, 2, 2)
    await setupMeta({})

    // Структурные фазы
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: '2026-03-20T10:00:00Z' } })
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))

    // syncIncremental: нет изменений
    nockChangesEmpty(nock, '2026-03-20T11:00:00Z')
    // syncDailyStats: пустой отчёт
    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    const meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '2026-03-20T11:00:00Z')
    assert.isNull(meta.lastError)

    const counts = await countAll()
    assert.equal(counts.campaigns, 3)
    assert.equal(counts.adGroups, 6)
    assert.equal(counts.ads, 12)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-02: Сбой TIMESTAMP → retry → успех
  // ─────────────────────────────────────────────────────────────────────
  test('TC-02: Сбой на TIMESTAMP → phase=TIMESTAMP, FAILED → retry (force) → DONE', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 2, 2)
    await setupMeta({})

    nock.cleanAll()
    // ── Запуск 1: changes отвечает 500 ──
    nock(YANDEX_BASE).persist().post('/json/v5/changes').reply(500, { error: 'mock_500_for_test' })

    const { service } = makeService()
    await assert.rejects(() => service.sync())

    let meta = await reloadMeta()
    await meta.refresh()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.TIMESTAMP)
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.include(meta.lastError!, 'timestamp_unknown')
    assert.isNull(meta.lastTimestamp)

    nock.cleanAll()

    // ── Запуск 2 (force=true): всё ок ──
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: '2026-03-20T10:00:00Z' } })
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    nockChangesEmpty(nock, '2026-03-20T10:30:00Z')
    nockReportsEmpty(nock)

    await service.sync(true)

    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '2026-03-20T10:30:00Z')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-03: Timestamp ok → Campaigns error → retry пропускает TIMESTAMP
  // ─────────────────────────────────────────────────────────────────────
  test('TC-03: Timestamp ok → Campaigns error → phase=CAMPAIGNS, timestamp сохранён → retry пропускает /changes', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 1, 1)
    await setupMeta({})

    // ── Запуск 1 ──
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: 'ts-first' } })
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(400)

    const { service } = makeService()
    await assert.rejects(() => service.sync())

    let meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.CAMPAIGNS)
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.include(meta.lastError!, 'campaigns_unknown')
    // Timestamp уже сохранён (syncTimestamp меняет meta.lastTimestamp перед save)
    assert.equal(meta.lastTimestamp, 'ts-first')

    nock.cleanAll()

    // ── Запуск 2 (force=true): /changes НЕ вызывается ──
    // Только campaigns, adgroups, ads
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    // Вместо changes для структуры — changes вызовется только из syncIncremental
    nockChangesEmpty(nock, 'ts-incremental')
    nockReportsEmpty(nock)

    await service.sync(true)

    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)

    const counts = await countAll()
    assert.equal(counts.campaigns, campaigns.length)
    assert.equal(counts.adGroups, adGroups.length)
    assert.equal(counts.ads, ads.length)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-04: Campaigns ok → AdGroups error → phase=AD_GROUPS → retry пропускает CAMPAIGNS
  // ─────────────────────────────────────────────────────────────────────
  test('TC-04: Campaigns ok → AdGroups error → phase=AD_GROUPS → retry пропускает timestamp+campaigns', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 3, 1)
    await setupMeta({})

    nock.cleanAll()
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: 'ts-1' } })
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).persist().post('/json/v5/adgroups').reply(500)

    const { service } = makeService()
    await assert.rejects(() => service.sync())

    let meta = await reloadMeta()
    await meta.refresh()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.AD_GROUPS)
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.include(meta.lastError!, 'adgroups_unknown')

    // Кампании уже загружены в БД
    const { campaigns: campaignCount } = await countAll()
    assert.equal(campaignCount, campaigns.length)

    nock.cleanAll()

    // ── Запуск 2 (force=true): только adgroups + ads ──
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    nockChangesEmpty(nock, 'ts-inc')
    nockReportsEmpty(nock)

    await service.sync(true)

    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)

    const counts = await countAll()
    assert.equal(counts.campaigns, campaigns.length) // не изменилось (idempotent)
    assert.equal(counts.adGroups, adGroups.length)
    assert.equal(counts.ads, ads.length)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-05: AdGroups ok → Ads error → phase=ADS → retry пропускает всё кроме ADS
  // ─────────────────────────────────────────────────────────────────────
  test('TC-05: AdGroups ok → Ads error → phase=ADS → retry только ads → DONE', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 2, 3)
    await setupMeta({})

    nock.cleanAll()
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: 'ts-1' } })
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).persist().post('/json/v5/ads').reply(500)

    const { service } = makeService()
    await assert.rejects(() => service.sync())

    let meta = await reloadMeta()
    await meta.refresh()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.ADS)
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.include(meta.lastError!, 'ads_unknown')

    const counts1 = await countAll()
    assert.equal(counts1.campaigns, campaigns.length)
    assert.equal(counts1.adGroups, adGroups.length)
    assert.equal(counts1.ads, 0)

    nock.cleanAll()

    // ── Запуск 2 (force=true): только ads ──
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    nockChangesEmpty(nock, 'ts-inc')
    nockReportsEmpty(nock)

    await service.sync(true)

    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.isNull(meta.lastError)

    const counts2 = await countAll()
    assert.equal(counts2.ads, ads.length)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-06: Полный лестничный тест возобновляемости (golden path)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-06: Лестничный тест — каждый run проваливает одну фазу → итог DONE', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 2, 2)
    await setupMeta({})
    const { service } = makeService()

    nock.cleanAll()
    // ─ Run 1: any post → 500, остаёмся на TIMESTAMP ─
    nock(YANDEX_BASE).persist().post(/.*/).reply(500, { error: 'run1_fail' })
    await assert.rejects(() => service.sync())
    let meta = await reloadMeta()
    await meta.refresh()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.TIMESTAMP, 'Run1 phase')
    assert.equal(meta.syncStatus, SyncStatus.FAILED, 'Run1 status')
    assert.include(meta.lastError!, 'timestamp_unknown', 'Run1 error')
    nock.cleanAll()

    // ─ Run 2: timestamp ok, campaigns → 400 ─
    nock(YANDEX_BASE)
      .post(/changes/)
      .reply(200, { result: { Timestamp: 'ts-run2' } })
    nock(YANDEX_BASE)
      .post(/campaigns/)
      .reply(400)
    await assert.rejects(() => service.sync(true))
    meta = await reloadMeta()
    await meta.refresh()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.CAMPAIGNS, 'Run2 phase')
    assert.equal(meta.syncStatus, SyncStatus.FAILED, 'Run2 status')
    assert.include(meta.lastError!, '400', 'Run2 error')
    assert.equal(meta.lastTimestamp, 'ts-run2', 'Run2 timestamp saved')
    nock.cleanAll()

    // ─ Run 3: campaigns ok, adgroups → 500 ─
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(500)
    await assert.rejects(() => service.sync(true))
    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.AD_GROUPS, 'Run3 phase')
    assert.equal(meta.syncStatus, SyncStatus.FAILED, 'Run3 status')
    assert.include(meta.lastError!, 'adgroups_unknown', 'Run3 error')
    nock.cleanAll()

    // ─ Run 4: adgroups ok, ads → 500 ─
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(500)
    await assert.rejects(() => service.sync(true))
    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.ADS, 'Run4 phase')
    assert.equal(meta.syncStatus, SyncStatus.FAILED, 'Run4 status')
    assert.include(meta.lastError!, 'ads_unknown', 'Run4 error')
    nock.cleanAll()

    // ─ Run 5: ads ok → DONE ─
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    nockChangesEmpty(nock, 'ts-run5')
    nockReportsEmpty(nock)
    await service.sync(true)
    meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE, 'Run5 phase')
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS, 'Run5 status')
    assert.isNull(meta.lastError, 'Run5 no error')

    const counts = await countAll()
    assert.equal(counts.campaigns, campaigns.length)
    assert.equal(counts.adGroups, adGroups.length)
    assert.equal(counts.ads, ads.length)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-07: FAILED без force — sync() игнорируется
  // ─────────────────────────────────────────────────────────────────────
  test('TC-07: FAILED без force — sync() ничего не делает (нет HTTP-запросов)', async ({
    assert,
  }) => {
    await setupMeta({
      syncStatus: SyncStatus.FAILED,
      referenceSyncPhase: ReferenceSyncPhase.AD_GROUPS,
      lastError: 'adgroups_unknown',
    })

    // Намеренно НЕ добавляем nock-моки — если запрос произошел, тест упадёт

    const { service } = makeService()
    // Не должен бросать исключение
    await service.sync()

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.FAILED, 'статус не изменился')
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.AD_GROUPS, 'phase не изменилась')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-08: IN_PROGRESS сессия сбрасывается и продолжается с сохранённой фазы
  // ─────────────────────────────────────────────────────────────────────
  test('TC-08: IN_PROGRESS → сбрасывается в PENDING → продолжает с phase=CAMPAIGNS', async ({
    assert,
  }) => {
    const { campaigns, adGroups, ads } = makeDataSet(1, 2, 2)
    await setupMeta({
      syncStatus: SyncStatus.IN_PROGRESS,
      referenceSyncPhase: ReferenceSyncPhase.CAMPAIGNS,
      lastTimestamp: 'ts-existing',
    })

    // Только campaigns, adgroups, ads — timestamp/changes НЕ должен вызываться для структуры
    nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
    nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
    nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
    nockChangesEmpty(nock, 'ts-inc')
    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-09: Нет long_token — немедленный выброс, phase не меняется
  // ─────────────────────────────────────────────────────────────────────
  test('TC-09: Нет long_token → MetaTokenUnavailableError, phase остаётся null', async ({
    assert,
  }) => {
    await setupMeta({ token: null })

    const { service } = makeService()
    await assert.rejects(() => service.sync(), MetaTokenUnavailableError)

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.isNull(meta.referenceSyncPhase)
    assert.equal(meta.lastError, 'token_unavailable')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-10: Нет syncStartDate — немедленный выброс
  // ─────────────────────────────────────────────────────────────────────
  test('TC-10: Нет syncStartDate → MetaSyncStartDateUnavailableError', async ({ assert }) => {
    await setupMeta({ syncStartDate: null })

    const { service } = makeService()
    await assert.rejects(() => service.sync(), MetaSyncStartDateUnavailableError)

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.FAILED)
    assert.equal(meta.lastError, 'sync_start_date_unavailable')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-11: ApiLimitError → PARTIAL, phase не продвигается
  // ─────────────────────────────────────────────────────────────────────
  test('TC-11: ApiLimitError на campaigns → syncStatus=PARTIAL, phase=CAMPAIGNS', async ({
    assert,
  }) => {
    await setupMeta({})

    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: 'ts-1' } })
    // Яндекс возвращает 200 с error-объектом при превышении лимита
    nock(YANDEX_BASE)
      .post('/json/v5/campaigns')
      .reply(200, { error: { error_code: 152, error_string: 'Daily limit reached' } })

    const { service } = makeService()
    try {
      await service.sync()
    } catch {
      /* ошибка пробрасывается из handleError */
    }

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.PARTIAL)
    assert.include(meta.lastError!, 'Daily limit reached')
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.CAMPAIGNS)
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-12: Phase уже DONE — структурный блок пропускается, запросы к campaigns/adgroups/ads не делаются
  // ─────────────────────────────────────────────────────────────────────
  test('TC-12: phase=DONE → структурный блок пропускается, вызывается только syncIncremental', async ({
    assert,
  }) => {
    await setupMeta({
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      lastTimestamp: 'ts-existing',
    })

    // Структурные эндпоинты НЕ должны вызываться
    // Если они вызовутся — nock.pendingMocks() в teardown не поймает,
    // но nock.disableNetConnect(); nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/) отклонит реальный запрос с ошибкой → тест упадёт

    // Только incremental + reports
    nockChangesEmpty(nock, 'ts-new')
    nockReportsEmpty(nock)

    const { service } = makeService()
    await service.sync()

    const meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, 'ts-new')
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-15: Идемпотентность — повторный полный синк не дублирует данные
  // ─────────────────────────────────────────────────────────────────────
  test('TC-15: Повторный полный синк с тем же датасетом не создаёт дубли', async ({ assert }) => {
    const { campaigns, adGroups, ads } = makeDataSet(2, 2, 2)
    await setupMeta({})

    const setupNocks = (ts: string) => {
      nock(YANDEX_BASE)
        .post('/json/v5/changes')
        .reply(200, { result: { Timestamp: ts } })
      nock(YANDEX_BASE).post('/json/v5/campaigns').reply(200, toApiResponse('Campaigns', campaigns))
      nock(YANDEX_BASE).post('/json/v5/adgroups').reply(200, toApiResponse('AdGroups', adGroups))
      nock(YANDEX_BASE).post('/json/v5/ads').reply(200, toApiResponse('Ads', ads))
      nockChangesEmpty(nock, `${ts}-inc`)
      nockReportsEmpty(nock)
    }

    const { service } = makeService()

    // Первый полный синк
    setupNocks('ts-run1')
    await service.sync()
    const counts1 = await countAll()

    // Сбрасываем phase чтобы структурный блок запустился снова
    const meta = await reloadMeta()
    meta.referenceSyncPhase = null
    await meta.save()

    // Второй полный синк с тем же датасетом
    nock.cleanAll()
    setupNocks('ts-run2')
    await service.sync()
    const counts2 = await countAll()

    // Данные не дублируются — updateOrCreate гарантирует идемпотентность
    assert.equal(counts2.campaigns, counts1.campaigns)
    assert.equal(counts2.adGroups, counts1.adGroups)
    assert.equal(counts2.ads, counts1.ads)
  })
})
