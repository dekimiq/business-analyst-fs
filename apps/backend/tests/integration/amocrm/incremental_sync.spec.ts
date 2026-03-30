/**
 * @suite integration
 *
 * Тесты инкрементальной синхронизации AmoCRM (События + Сделки).
 * Охватывает кейсы: TC-INC-01, TC-INC-02, TC-INC-03.
 */

import { test } from '@japa/runner'
import nock from 'nock'
import CrmRecord from '#models/crm_record'
import { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'
import { AmocrmSyncServiceFacade } from '#services/amocrm/index'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import { cleanDatabase, setupMeta, reloadMeta, AMOCRM_BASE } from './helpers.js'
import { makeAmoEvent, makeAmoLead, toEventsResponse, toLeadsResponse } from './factories.js'
import { DateTime } from 'luxon'

function makeService() {
  const api = new AmocrmApiClient('test_token', {
    domain: 'ratelead.amocrm.ru',
    client_id: 'test_id',
    client_secret: 'test_secret',
  })
  const service = new AmocrmSyncServiceFacade(api)
  return { api, service }
}

test.group('AmoCRM Sync: Инкрементальный модуль', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    await cleanDatabase()
  })

  group.each.teardown(() => {
    if (!nock.isDone()) {
      const pending = nock.pendingMocks()
      nock.cleanAll()
      throw new Error(`Nock: остались неиспользованные моки:\n  ${pending.join('\n  ')}`)
    }
  })

  test('TC-INC-01: Создание сделки (lead_added) c UTM-меткой', async ({ assert }) => {
    const leadId = 1001
    const eventTime = Math.floor(DateTime.now().minus({ minutes: 5 }).toSeconds())

    // Мокаем события: 1 событие
    const event = makeAmoEvent('ev-1', 'lead_added', leadId)
    event.created_at = eventTime

    await setupMeta({
      lastTimestamp: String(eventTime - 100),
      referenceSyncPhase: ReferenceSyncPhase.DONE,
    })

    // 1. Запрос событий (только одна страница)
    nock(AMOCRM_BASE)
      .get('/api/v4/events')
      .query(true)
      .reply(200, toEventsResponse([event])!)

    // 2. Запрос данных сделки с UTM-меткой (ID рекламной кампании)
    const mockLead = makeAmoLead(leadId, {
      name: 'Test Lead with UTM',
      custom_fields_values: [
        {
          field_name: 'utm_campaign',
          values: [{ value: '1234567' }], // Наш regex /\d{7,19}/ поймает это
        },
      ],
    })
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, toLeadsResponse([mockLead]))

    const { service } = makeService()
    await service.sync(false, 'light')

    const record = await CrmRecord.findByOrFail('dealId', String(leadId))
    assert.equal(record.dealName, 'Test Lead with UTM')
    assert.equal(record.rawIds, '1234567')

    const meta = await reloadMeta()
    assert.equal(meta.lastTimestamp, String(eventTime))
  })

  test('TC-INC-02: Удаление сделки (lead_deleted)', async ({ assert }) => {
    const leadId = 2002
    // Сначала создаем "живую" сделку в БД
    await CrmRecord.create({
      source: 'amocrm',
      dealId: String(leadId),
      dealName: 'To be deleted',
      isDeleted: false,
    })

    const eventTime = Math.floor(DateTime.now().toSeconds())
    const event = makeAmoEvent('ev-2', 'lead_deleted', leadId)
    event.created_at = eventTime

    await setupMeta({
      lastTimestamp: String(eventTime - 10),
      referenceSyncPhase: ReferenceSyncPhase.DONE,
    })

    nock(AMOCRM_BASE)
      .get('/api/v4/events')
      .query(true)
      .reply(200, toEventsResponse([event])!)

    const { service } = makeService()
    await service.sync(false, 'light')

    const record = await CrmRecord.findByOrFail('dealId', String(leadId))
    assert.isTrue(record.isDeleted, 'Флаг isDeleted должен стать true')
  })

  test('TC-INC-03: Восстановление сделки (lead_restored)', async ({ assert }) => {
    const leadId = 3003
    // Сначала создаем "удаленную" сделку в БД
    await CrmRecord.create({
      source: 'amocrm',
      dealId: String(leadId),
      dealName: 'Restored lead',
      isDeleted: true,
    })

    const eventTime = Math.floor(DateTime.now().toSeconds())
    const event = makeAmoEvent('ev-3', 'lead_restored', leadId)
    event.created_at = eventTime

    await setupMeta({
      lastTimestamp: String(eventTime - 10),
      referenceSyncPhase: ReferenceSyncPhase.DONE,
    })

    nock(AMOCRM_BASE)
      .get('/api/v4/events')
      .query(true)
      .reply(200, toEventsResponse([event])!)

    // При восстановлении сервис качает данные сделки заново
    const mockLead = makeAmoLead(leadId, { name: 'Restored lead' })
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, toLeadsResponse([mockLead]))

    const { service } = makeService()
    await service.sync(false, 'light')

    const record = await CrmRecord.findByOrFail('dealId', String(leadId))
    assert.isFalse(record.isDeleted, 'Флаг isDeleted должен вернуться в false')
  })
})
