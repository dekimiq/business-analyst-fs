/**
 * @suite integration
 *
 * Тесты синхронизации структурных данных AmoCRM (Воронки и Статусы).
 */

import { test } from '@japa/runner'
import nock from 'nock'
import CrmPipeline from '#models/crm_pipeline'
import CrmStatus from '#models/crm_status'
import { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'
import { AmocrmSyncServiceFacade } from '#services/amocrm/index'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import { cleanDatabase, reloadMeta, setupMeta, AMOCRM_BASE } from './helpers.js'
import { makeAmoCrmPipeline, toPipelinesResponse } from './factories.js'
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

test.group('AmoCRM Sync: Структурная синхронизация', (group) => {
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

  test('TC-REF-01: Успешное получение воронки и статусов', async ({ assert }) => {
    // 1. Подготовка данных
    const pipelineData = makeAmoCrmPipeline(7288570, 'RateLead', [
      { id: 60727594, name: 'Неразобранное' },
      { id: 60727598, name: 'Назначен ответсвенный' },
    ])
    const response = toPipelinesResponse([pipelineData])

    await setupMeta({
      syncStartDate: DateTime.now().minus({ days: 30 }),
      credentials: {
        domain: 'ratelead.amocrm.ru',
        client_id: 'api_id',
        client_secret: 'api_secret',
        long_token: 'test_long_token',
      },
    })

    // 2. Мокаем API
    // syncPipelinesAndStatuses запрашивает /api/v4/leads/pipelines
    nock(AMOCRM_BASE).get('/api/v4/leads/pipelines').reply(200, response)

    // Мокаем вызовы данных, чтобы тест не упал на следующих фазах (heavy mode)
    // Historical sync будет вызван, так как lastTimestamp пуст
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true) // любые query параметры
      .reply(200, { _embedded: { leads: [] } })

    const { service } = makeService()

    // 3. Запуск
    await service.sync(false, 'heavy')

    // 4. Проверки
    const meta = await reloadMeta()
    assert.equal(meta.referenceSyncPhase, ReferenceSyncPhase.DONE)
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)

    // Проверяем воронку
    const pipeline = await CrmPipeline.query()
      .where('id', '7288570')
      .preload('statuses')
      .firstOrFail()
    assert.equal(pipeline.name, 'RateLead')
    assert.equal(pipeline.source, 'amocrm')

    // Проверяем статусы
    assert.equal(pipeline.statuses.length, 2)
    const statusNames = pipeline.statuses.map((s) => s.name)
    assert.include(statusNames, 'Неразобранное')
    assert.include(statusNames, 'Назначен ответсвенный')

    pipeline.statuses.forEach((s) => {
      assert.equal(s.source, 'amocrm')
      assert.equal(s.pipelineId, '7288570')
    })
  })

  test('Идемпотентность: повторный запуск не дублирует воронки', async ({ assert }) => {
    // 1. Первый запуск
    const pipelineData = makeAmoCrmPipeline(7288570, 'RateLead', [
      { id: 60727594, name: 'Неразобранное' },
    ])

    await setupMeta({
      syncStartDate: DateTime.now().minus({ days: 30 }),
      credentials: {
        domain: 'ratelead.amocrm.ru',
        client_id: 'api_id',
        client_secret: 'api_secret',
        long_token: 'test_long_token',
      },
    })

    nock(AMOCRM_BASE)
      .get('/api/v4/leads/pipelines')
      .reply(200, toPipelinesResponse([pipelineData]))
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, { _embedded: { leads: [] } })

    const { service } = makeService()
    await service.sync(false, 'heavy')

    // 2. Сбрасываем фазу для повторного теста структуры
    const meta = await reloadMeta()
    meta.referenceSyncPhase = null
    await meta.save()

    // 3. Второй запуск с теми же данными
    nock(AMOCRM_BASE)
      .get('/api/v4/leads/pipelines')
      .reply(200, toPipelinesResponse([pipelineData]))
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(200, { _embedded: { leads: [] } })

    await service.sync(false, 'heavy')

    // 4. Проверка количества
    const pipelines = await CrmPipeline.query().where('source', 'amocrm')
    assert.lengthOf(pipelines, 1)

    const statuses = await CrmStatus.query().where('source', 'amocrm')
    assert.lengthOf(statuses, 1)
  })
})
