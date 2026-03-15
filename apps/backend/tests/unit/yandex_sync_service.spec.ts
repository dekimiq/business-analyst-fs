import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import nock from 'nock'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import { YandexSyncService } from '#services/sync/yandex_sync_service'
import {
  MetaSyncStartDateUnavailableError,
  MetaTokenUnavailableError,
} from '#exceptions/sync_exceptions'
import { YandexApiClient } from '#services/yandex/yandex_api_client'

import campaignsFixture from '../../app/__fixtures__/yandex/campaigns.json' with { type: 'json' }
import adGroupsFixture from '../../app/__fixtures__/yandex/adgroups.json' with { type: 'json' }
import adsFixture from '../../app/__fixtures__/yandex/ads.json' with { type: 'json' }

async function cleanDatabase() {
  await db.rawQuery(
    'TRUNCATE TABLE integration_metadata, campaigns, ad_groups, ads, daily_stats RESTART IDENTITY CASCADE'
  )
}

async function setupMeta(overrides: Partial<IntegrationMetadata> = {}) {
  const meta = new IntegrationMetadata()
  meta.source = 'yandex'
  meta.token = overrides.token !== undefined ? overrides.token : 'test-token'
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

  test('Идеальный сценарий: Успешная интеграция (3 месяца)', async ({ assert }) => {
    const syncStartDate = DateTime.now().minus({ months: 3 }).startOf('day')
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

    const meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '2026-03-01T00:00:00Z')
    assert.isNull(meta.lastError)
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
  })

  test('Работа при ошибках интеграции: последовательный сбой и возобновление', async ({
    assert,
  }) => {
    const syncStartDate = DateTime.now().minus({ months: 1 }).startOf('day')
    await setupMeta({ syncStartDate })

    const api = new YandexApiClient('test-token')
    const service = new YandexSyncService(api)
    const yandexBase = 'https://api.direct.yandex.com'

    nock(yandexBase).post('/json/v5/campaigns').reply(500)
    await assert.rejects(() => service.sync())
    let meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.lastError, 'campaigns_unknown')
    assert.equal(meta.syncStatus, SyncStatus.ERROR)

    nock.cleanAll()
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
      .reply(500)

    await assert.rejects(() => service.sync())
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.PARTIAL)

    // Этап 3: Финальный успех — reports отдаёт 200
    nock.cleanAll()
    nock(yandexBase)
      .persist()
      .post('/json/v5/changes')
      .reply(200, { result: { Timestamp: '2026-03-03T00:00:00Z' } })
      .post('/json/v5/reports')
      .reply(200, 'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n', {
        'Content-Type': 'text/plain',
      })

    await service.sync()
    meta = await IntegrationMetadata.query().firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.isNull(meta.lastError)
  })

  test('Работа endpoints: отсутствие токена / даты', async ({ assert }) => {
    const api = new YandexApiClient('')
    const service = new YandexSyncService(api)

    // Отсутствие токена
    await setupMeta({ token: null })
    try {
      await service.sync()
      assert.fail('Должна быть ошибка MetaTokenUnavailableError')
    } catch (error: any) {
      assert.instanceOf(error, MetaTokenUnavailableError)

      const meta = await IntegrationMetadata.query().firstOrFail()
      assert.equal(meta.syncStatus, SyncStatus.ERROR)
      assert.equal(meta.lastError, 'token_unavailable')
    }

    // Отсутствие даты
    nock.cleanAll()
    await cleanDatabase()
    await setupMeta({ token: 'valid', syncStartDate: null })
    const api2 = new YandexApiClient('valid')
    const service2 = new YandexSyncService(api2)
    try {
      await service2.sync()
      assert.fail('Должна быть ошибка MetaSyncStartDateUnavailableError')
    } catch (error: any) {
      assert.instanceOf(error, MetaSyncStartDateUnavailableError)

      const meta = await IntegrationMetadata.query().firstOrFail()
      assert.equal(meta.syncStatus, SyncStatus.ERROR)
      assert.equal(meta.lastError, 'sync_start_date_unavailable')
    }
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
