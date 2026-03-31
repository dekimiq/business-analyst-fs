/**
 * @suite integration
 *
 * Тесты исторической синхронизации AmoCRM (Adaptive / Periodic).
 * Охватывает кейсы: TC-HIST-01, TC-HIST-02.
 */

import { test } from '@japa/runner'
import nock from 'nock'
import { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'
import { AmocrmSyncServiceFacade } from '#services/amocrm/index'
import { AmocrmApiClient } from '#services/amocrm/amocrm_api_client'
import { cleanDatabase, setupMeta, reloadMeta, AMOCRM_BASE } from './helpers.js'
import { makeAmoLead, toLeadsResponse, toPipelinesResponse } from './factories.js'
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

test.group('AmoCRM Sync: Историческая синхронизация', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/)
    await cleanDatabase()
  })

  group.each.teardown(() => {
    nock.cleanAll()
  })

  test('TC-HIST-01: Успешная выгрузка за 30 дней', async ({ assert }) => {
    // 1. Подготовка: старт 30 дней назад
    const startDate = DateTime.now().minus({ days: 30 }).startOf('day')
    const endDate = startDate.plus({ days: 30 })

    const leadId = 9001
    const lead = makeAmoLead(leadId, { updated_at: Math.floor(endDate.toSeconds()) })

    await setupMeta({
      syncStartDate: startDate,
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      historicalSyncedUntil: null,
      historicalSyncState: { chunkSize: 30 },
    })

    // В режиме heavy сервис ВСЕГДА проверяет воронки
    nock(AMOCRM_BASE).get('/api/v4/leads/pipelines').reply(200, toPipelinesResponse([]))

    // 2. Мокаем API leads
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query((q) => q['filter[updated_at][from]'] !== undefined)
      .reply(200, toLeadsResponse([lead]))

    const { service } = makeService()
    await service.sync(false, 'heavy')

    const meta = await reloadMeta()
    assert.equal(meta.syncStatus, SyncStatus.SUCCESS)
    assert.exists(meta.historicalSyncedUntil)
  })

  test('TC-HIST-02: Адаптивное окно (сжатие при ошибке 400)', async ({ assert }) => {
    const startDate = DateTime.now().minus({ days: 60 }).startOf('day')

    await setupMeta({
      syncStartDate: startDate,
      referenceSyncPhase: ReferenceSyncPhase.DONE,
      historicalSyncedUntil: null,
      historicalSyncState: { chunkSize: 30 },
    })

    // В режиме heavy сервис ВСЕГДА проверяет воронки
    nock(AMOCRM_BASE).get('/api/v4/leads/pipelines').reply(200, toPipelinesResponse([]))

    // 2. Мокаем ошибку 400
    nock(AMOCRM_BASE)
      .get('/api/v4/leads')
      .query(true)
      .reply(400, { title: 'Bad Request', detail: 'Period too large' })

    const { service } = makeService()
    await service.sync(false, 'heavy')

    const meta = await reloadMeta()
    const state = meta.historicalSyncState as any
    assert.equal(state.chunkSize, 15, 'Окно должно сжаться в 2 раза (30 -> 15)')
    assert.equal(state.lastError, 'Bad Request: Period too large')
  })
})
