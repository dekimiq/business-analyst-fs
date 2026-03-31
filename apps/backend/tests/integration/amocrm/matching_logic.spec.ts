/**
 * @suite integration
 *
 * Тесты логики сопоставления и fallback механизмов AmoCRM.
 */

import { test } from '@japa/runner'
import nock from 'nock'
import Campaign from '#models/campaign'
import CrmRecord from '#models/crm_record'
import { AmocrmSyncServiceFacade } from '#services/amocrm/index'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import { cleanDatabase as baseClean, setupMeta, AMOCRM_BASE } from './helpers.js'
import { makeAmoLead, toLeadsResponse, toPipelinesResponse } from './factories.js'
import { DateTime } from 'luxon'

async function cleanDatabase() {
  await baseClean()
  // Удаляем также кампании для чистоты теста
  await Campaign.query().delete()
}

function makeService() {
  const api = new AmocrmApiClient('test_token', {
    domain: 'ratelead.amocrm.ru',
    client_id: 'test_id',
    client_secret: 'test_secret',
  })
  return new AmocrmSyncServiceFacade(api)
}

test.group('AmoCRM Logic: Сопоставление и Fallback', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/)
    await cleanDatabase()
  })

  group.each.teardown(() => {
    nock.cleanAll()
  })

  test('Успешная связка с существующей кампанией (Real-time linking)', async ({ assert }) => {
    // 1. Создаем кампанию в БД
    const campaignId = '12345678'
    const campaign = await Campaign.create({
      campaignId,
      source: 'yandex',
      name: 'Test Campaign',
    })

    // 2. Имитируем сделку из AmoCRM с этим ID в UTM
    const lead = makeAmoLead(100, {
      custom_fields_values: [
        {
          field_name: 'utm_campaign',
          values: [{ value: campaignId }],
        },
      ],
    })

    await setupMeta({
      syncStartDate: DateTime.now().minus({ days: 1 }),
      historicalSyncedUntil: null,
      historicalSyncState: { chunkSize: 30 },
    })

    nock(AMOCRM_BASE).get('/api/v4/leads/pipelines').reply(200, toPipelinesResponse([]))
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, toLeadsResponse([lead]))

    const service = makeService()
    await service.sync(false, 'heavy')

    // 3. Проверяем результат
    const record = await CrmRecord.findByOrFail('dealId', '100')
    assert.equal(record.campaignId, campaignId)
    assert.equal(record.campaignPk, campaign.id)
    assert.isNull(record.rawIds, 'rawIds должен быть пустым, так как нашли прямую связку')
  })

  test('Запись в rawIds (rad_id) если соответствие не найдено (Heavy fallback)', async ({
    assert,
  }) => {
    // 1. Имитируем сделку с ID в названии, которой НЕТ в БД
    const unknownId = '87654321'
    const lead = makeAmoLead(200, {
      name: `Сделка по рекламе ${unknownId}`,
      custom_fields_values: [],
    })

    await setupMeta({
      syncStartDate: DateTime.now().minus({ days: 1 }),
      historicalSyncedUntil: null,
      historicalSyncState: { chunkSize: 30 },
    })

    nock(AMOCRM_BASE).get('/api/v4/leads/pipelines').reply(200, toPipelinesResponse([]))
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, toLeadsResponse([lead]))

    const service = makeService()
    await service.sync(false, 'heavy')

    // 2. Проверяем, что ID попал в rawIds
    const record = await CrmRecord.findByOrFail('dealId', '200')
    assert.isNull(record.campaignPk, 'campaignPk должен быть null')
    assert.isNull(record.campaignId, 'campaignId должен быть null')
    assert.equal(record.rawIds, unknownId, 'ID должен попасть в rawIds (поле rad_id)')
  })
})
