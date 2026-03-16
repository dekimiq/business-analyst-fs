import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import nock from 'nock'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import { AmocrmSyncService } from '#services/sync/amocrm_sync_service'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import CrmRecord from '#models/crm_record'

import leadsFixture from '../../app/__fixtures__/amocrm/leads.json' with { type: 'json' }

async function cleanDatabase() {
  await db.rawQuery(
    'TRUNCATE TABLE integration_metadata, campaigns, ad_groups, ads, daily_stats, crm_records RESTART IDENTITY CASCADE'
  )
}

async function setupAmocrmMeta(overrides: Partial<IntegrationMetadata> = {}) {
  return IntegrationMetadata.updateOrCreate(
    { source: 'amocrm' },
    {
      token: overrides.token !== undefined ? overrides.token : 'test-token',
      lastTimestamp: overrides.lastTimestamp ?? null,
      syncStartDate: overrides.syncStartDate ?? null,
      syncedUntil: overrides.syncedUntil ?? null,
      lastSuccessSyncDate: overrides.lastSuccessSyncDate ?? null,
      syncStatus: overrides.syncStatus ?? null,
      lastError: overrides.lastError ?? null,
      referenceSyncPhase: overrides.referenceSyncPhase ?? null,
      config: {
        domain: 'example.amocrm.ru',
        client_id: '123456789',
        client_secret: '123456789',
      },
    }
  )
}

async function setupYandexMeta(phase = ReferenceSyncPhase.DONE) {
  return IntegrationMetadata.updateOrCreate(
    { source: 'yandex' },
    {
      token: 'yandex-test-token',
      syncStatus: SyncStatus.SUCCESS,
      referenceSyncPhase: phase,
    }
  )
}

test.group('AmocrmSyncService: Логика интеграции', (group) => {
  group.setup(async () => {
    nock.disableNetConnect()
    try {
      await db.rawQuery('SELECT 1')
    } catch (e) {
      console.error('[TEST] DB Connection FAILED:', e)
    }
  })

  group.teardown(() => {
    nock.enableNetConnect()
  })

  group.each.setup(() => {
    nock.cleanAll()
    return cleanDatabase()
  })

  test('Ожидание справочников: ожидание Yandex и переход в частичное состояние (Partial)', async ({
    assert,
  }) => {
    await setupAmocrmMeta()
    await setupYandexMeta(ReferenceSyncPhase.CAMPAIGNS)

    const api = new AmocrmApiClient('test-token', {
      domain: 'example.amocrm.ru',
      client_id: '123456789',
      client_secret: '123456789',
    })

    const service = new AmocrmSyncService(api)

    // @ts-ignore - игнорируем private
    service.sleep = () => Promise.resolve()

    await assert.rejects(() => service.sync(), /Ожидание справочников прервано по таймауту/)

    const meta = await IntegrationMetadata.query().where('source', 'amocrm').firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.PARTIAL)
    assert.equal(meta.lastError, 'Ожидание справочников прервано по таймауту (60 сек)')
  })

  test('Успешная интеграция (Первичная + Инкрементальная проверка изменений)', async ({
    assert,
  }) => {
    await setupAmocrmMeta()
    await setupYandexMeta(ReferenceSyncPhase.DONE)

    const c1 = await Campaign.create({ source: 'yandex', campaignId: 40432140, name: 'C1' })
    const g1 = await AdGroup.create({
      source: 'yandex',
      groupId: 3664899912,
      campaignId: c1.id,
      name: 'G1',
    })
    const a1 = await Ad.create({
      source: 'yandex',
      adId: 6928734901,
      groupId: g1.id,
      title: 'A1',
    })

    const amoBase = 'https://example.amocrm.ru'

    // ЭТАП 1: Первичная синхронизация (получаем 10 лидов из фикстуры)
    nock(amoBase)
      .persist()
      .get('/api/v4/leads')
      .query((parsedQuery) => {
        return !Object.keys(parsedQuery).some((k) => k.includes('filter'))
      })
      .reply(200, {
        _embedded: {
          leads: leadsFixture._embedded.leads.slice(0, 10),
        },
        _page: 1,
        _page_count: 1,
      })

    const api = new AmocrmApiClient('test-token', {
      domain: 'example.amocrm.ru',
      client_id: '123456789',
      client_secret: '123456789',
    })

    const service = new AmocrmSyncService(api)
    // @ts-ignore
    service.sleep = () => Promise.resolve()

    await service.sync()

    let meta = await IntegrationMetadata.query().where('source', 'amocrm').firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '1708093200')

    const recordsCounts1 = await CrmRecord.query().count('* as total')
    assert.equal(recordsCounts1[0].$extras.total, 10)

    const firstRecord = await CrmRecord.query().where('deal_id', '10000001').firstOrFail()
    assert.equal(firstRecord.campaignId, c1.id)
    assert.equal(firstRecord.groupId, g1.id)
    assert.equal(firstRecord.adId, a1.id)
    assert.equal(firstRecord.referrer, 'yandex')

    // ЭТАП 2: Инкрементальная проверка
    nock.cleanAll()
    nock(amoBase)
      .persist()
      .get('/api/v4/leads')
      .query((parsedQuery) => {
        return parsedQuery['filter[updated_at][from]'] === '1708093200'
      })
      .reply(200, {
        _embedded: {
          leads: leadsFixture._embedded.leads.slice(10, 12),
        },
        _page: 1,
        _page_count: 1,
      })

    await service.sync()

    meta = await IntegrationMetadata.query().where('source', 'amocrm').firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.equal(meta.lastTimestamp, '1708113800')

    const recordsCounts2 = await CrmRecord.query().count('* as total')
    assert.equal(recordsCounts2[0].$extras.total, 12)
  })

  test('Обработка ошибки токена (401 Unauthorized)', async ({ assert }) => {
    await setupAmocrmMeta()
    await setupYandexMeta(ReferenceSyncPhase.DONE)

    const amoBase = 'https://example.amocrm.ru'
    nock(amoBase).persist().get('/api/v4/leads').query(true).reply(401)

    const api = new AmocrmApiClient('test-token', {
      domain: 'example.amocrm.ru',
      client_id: '123456789',
      client_secret: '123456789',
    })

    const service = new AmocrmSyncService(api)
    // @ts-ignore
    service.sleep = () => Promise.resolve()

    await assert.rejects(() => service.sync())

    const meta = await IntegrationMetadata.query().where('source', 'amocrm').firstOrFail()
    assert.equal(meta.syncStatus, SyncStatus.ERROR)
    assert.equal(meta.lastError, 'auth_unavailable')
  })
})
