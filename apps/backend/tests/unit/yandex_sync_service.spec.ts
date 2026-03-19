import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import nock from 'nock'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import { YandexSyncService } from '#services/sync/yandex_sync_service'
import { YandexApiClient } from '#services/yandex/yandex_api_client'

import campaignsFixture from '../../app/__fixtures__/yandex/campaigns.json' with { type: 'json' }
import adGroupsFixture from '../../app/__fixtures__/yandex/adgroups.json' with { type: 'json' }
import adsFixture from '../../app/__fixtures__/yandex/ads.json' with { type: 'json' }

async function cleanDatabase() {
  await db.rawQuery(
    'TRUNCATE TABLE integration_metadata, campaigns, ad_groups, ads, daily_stats RESTART IDENTITY CASCADE'
  )
}

async function setupMeta(overrides: any = {}) {
  const meta = new IntegrationMetadata()
  meta.source = 'yandex'
  const credentials = (overrides.credentials as any) || {}
  meta.credentials = {
    long_token: overrides.token !== undefined ? overrides.token : 'test-token',
    ...credentials,
  }
  meta.lastTimestamp = overrides.lastTimestamp ?? null
  meta.syncStartDate =
    overrides.syncStartDate !== undefined
      ? overrides.syncStartDate
      : DateTime.now().minus({ days: 30 }).startOf('day')
  meta.syncedUntil = overrides.syncedUntil ?? null
  meta.lastSuccessSyncDate = overrides.lastSuccessSyncDate ?? null
  meta.syncStatus = overrides.syncStatus ?? null
  meta.lastError = overrides.lastError ?? null
  await meta.save()
  return meta
}

test.group('YandexSyncService: Логика интеграции', (group) => {
  group.setup(async () => {
    try {
      await db.rawQuery('SELECT 1')
    } catch (e) {
      console.error('[TEST] DB Connection FAILED:', e)
    }
  })

  group.each.setup(() => {
    nock.cleanAll()
    return cleanDatabase()
  })

  test('Идеальный сценарий: Успешная интеграция (3 месяца) и проверки changes.check', async ({
    assert,
  }) => {
    const syncStartDate = DateTime.now().minus({ months: 3 }).startOf('day')
    await setupMeta({ syncStartDate })

    const yandexBase = 'https://api.direct.yandex.com'

    // ЭТАП 1: Первичная синхронизация
    nock(yandexBase)
      .persist()
      .post('/json/v5/campaigns')
      .reply(200, campaignsFixture)
      .post('/json/v5/adgroups')
      .reply(200, adGroupsFixture)
      .post('/json/v5/ads')
      .reply(200, adsFixture)
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: '2026-03-01T00:00:00Z' } })
      .post('/json/v5/reports')
      .reply(
        200,
        'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n2026-03-01\t14849757093\t100\t5\t50000000\t5.0\t10000000',
        {
          'Content-Type': 'text/plain',
        }
      )

    const api = new YandexApiClient('test-token')
    const service = new YandexSyncService(api)

    await service.sync()

    let meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '2026-03-01T00:00:00Z')
    assert.isNull(meta.lastError)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)

    // ЭТАП 2: Запуск с наличием изменений в changes.check
    nock.cleanAll()
    const borderDate = DateTime.now().minus({ days: 2 }).toISODate()
    const campaignsCountCheckParams = campaignsFixture.result.Campaigns.map((c: any) => c.Id)
    const mockChangedCampaignId = campaignsCountCheckParams[0]

    nock(yandexBase)
      .persist()
      .post('/json/v5/changes')
      .reply(200, {
        result: {
          Timestamp: '2026-03-05T00:00:00Z',
          CampaignsStat: [{ CampaignId: mockChangedCampaignId, BorderDate: borderDate }],
        },
      })
      .post('/json/v5/reports')
      .reply(
        200,
        `Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n${borderDate}\t14849757093\t150\t10\t70000000\t6.6\t7000000`,
        {
          'Content-Type': 'text/plain',
        }
      )

    await service.sync()
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastTimestamp, '2026-03-05T00:00:00Z')
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)

    // ЭТАП 3: Запуск БЕЗ изменений в changes.check (отдает пустой массив). Ожидается запрос за 3 дня
    nock.cleanAll()
    const threeDaysAgoDate = DateTime.now().minus({ days: 3 }).toISODate()
    nock(yandexBase)
      .persist()
      .post('/json/v5/changes')
      .reply(200, {
        result: {
          Timestamp: '2026-03-07T00:00:00Z',
          CampaignsStat: [],
        },
      })
      .post('/json/v5/reports')
      .reply(
        200,
        `Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n${threeDaysAgoDate}\t14849757093\t200\t20\t90000000\t10.0\t4500000`,
        {
          'Content-Type': 'text/plain',
        }
      )

    await service.sync()
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastTimestamp, '2026-03-07T00:00:00Z')
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
  })

  test('Работа при ошибках интеграции: последовательный сбой и возобновление', async ({
    assert,
  }) => {
    const syncStartDate = DateTime.now().minus({ months: 1 }).startOf('day')
    await setupMeta({ syncStartDate })

    const api = new YandexApiClient('test-token')
    const service = new YandexSyncService(api)
    const yandexBase = 'https://api.direct.yandex.com'

    // 1. Сбой на timestamp
    const originalGetServerTimestamp = api.getServerTimestamp.bind(api)
    api.getServerTimestamp = async () => {
      throw new Error('Simulated timestamp error')
    }

    await assert.rejects(() => service.sync())
    let meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.lastError, 'timestamp_unknown')
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.TIMESTAMP)

    // Восстанавливаем timestamp функцию + 2. Сбой на campaigns
    api.getServerTimestamp = originalGetServerTimestamp
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/changes', (body) => body.method === 'check')
      .reply(200, { result: { Timestamp: 'test-timestamp' } })
    nock(yandexBase).persist().post('/json/v5/campaigns').reply(400)

    await assert.rejects(() => service.sync(true))
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastError, 'campaigns_unknown')
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.CAMPAIGNS)

    // 3. Удачные campaigns, сбой на adGroups
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/campaigns')
      .reply(200, campaignsFixture)
      .post('/json/v5/adgroups')
      .reply(400)

    await assert.rejects(() => service.sync(true))
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastError, 'adgroups_unknown')
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.AD_GROUPS)

    // 4. Удачные adGroups, сбой на ads
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/adgroups')
      .reply(200, adGroupsFixture)
      .post('/json/v5/ads')
      .reply(400)

    await assert.rejects(() => service.sync(true))
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastError, 'ads_unknown')
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.ADS)

    // 5. Удачные ads, сбой на reports (все периоды провалились)
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/ads')
      .reply(200, adsFixture)
      .post('/json/v5/reports')
      .reply(500)

    await assert.rejects(() => service.sync(true))
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.PARTIAL)
    assert.equal(meta.lastError, 'timeout')

    // 6. Удачные reports
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/reports')
      .reply(200, 'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n', {
        'Content-Type': 'text/plain',
      })

    await service.sync(true)
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.isNull(meta.lastError)
  })
  test('Сбой получения timestamp при первичной синхронизации', async ({ assert }) => {
    const syncStartDate = DateTime.now().minus({ months: 1 }).startOf('day')
    await setupMeta({ syncStartDate })

    const yandexBase = 'https://api.direct.yandex.com'
    nock(yandexBase)
      .persist()
      .post('/json/v5/campaigns')
      .reply(200, campaignsFixture)
      .post('/json/v5/adgroups')
      .reply(200, adGroupsFixture)
      .post('/json/v5/ads')
      .reply(200, adsFixture)

    const api = new YandexApiClient('test-token')
    const originalGetServerTimestamp = api.getServerTimestamp.bind(api)
    api.getServerTimestamp = async () => {
      throw new Error('Simulated timestamp error')
    }

    const service = new YandexSyncService(api)

    await assert.rejects(() => service.sync())
    const meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.lastError, 'timestamp_unknown')
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.TIMESTAMP)

    api.getServerTimestamp = originalGetServerTimestamp
  })

  test('Обработка ApiLimitError: перевод в PARTIAL', async ({ assert }) => {
    const syncStartDate = DateTime.now().minus({ months: 1 }).startOf('day')
    await setupMeta({ syncStartDate })

    const yandexBase = 'https://api.direct.yandex.com'
    nock(yandexBase)
      .persist()
      .post('/json/v5/campaigns')
      .reply(200, { error: { error_code: 152, error_string: 'Limit reached' } })

    const api = new YandexApiClient('test-token')
    const service = new YandexSyncService(api)

    try {
      await service.sync()
    } catch (e) {}

    const meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.PARTIAL)
    assert.equal(meta.lastError, 'api_limit_exceeded')
  })
})
