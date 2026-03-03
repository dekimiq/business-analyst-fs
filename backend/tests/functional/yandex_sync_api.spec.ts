/**
 * Functional (HTTP) тесты для YandexSyncController
 *
 * Тестируются все HTTP-эндпоинты синхронизации:
 *  GET  /api/sync/yandex/status
 *  POST /api/sync/yandex/initial
 *  POST /api/sync/yandex/daily
 *  POST /api/sync/yandex/continuation
 *
 * Матрица статусов и ожидаемых HTTP-ответов согласно TASK-yandex-sync-tests.md.
 *
 * NOTE: BullMQ queue.dispatch мокируется путём перехвата через env YANDEX_USE_MOCK=true,
 * но сам dispatch возвращает фиктивный jobId — в functional тестах мы проверяем
 * только HTTP-статус и структуру ответа, а не реальное выполнение джоба.
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'

// ---------------------------------------------------------------------------
// Хелпер: очистка integration_metadata между тестами
// ---------------------------------------------------------------------------

async function cleanMeta() {
  await db.rawQuery('TRUNCATE TABLE integration_metadata RESTART IDENTITY CASCADE')
}

// ---------------------------------------------------------------------------
// Хелпер: создать мета-запись
// ---------------------------------------------------------------------------

async function setupMeta(
  overrides: Partial<{
    syncStatus: IntegrationMetadata['syncStatus']
    syncStartDate: DateTime | null
    currentSyncDate: DateTime | null
    lastError: string | null
    lastSyncAt: DateTime | null
  }> = {}
) {
  const meta = new IntegrationMetadata()
  meta.source = 'yandex'
  meta.token = null
  meta.lastTimestamp = null
  meta.syncStartDate = overrides.syncStartDate ?? null
  meta.currentSyncDate = overrides.currentSyncDate ?? null
  meta.lastSyncAt = overrides.lastSyncAt ?? null
  meta.syncStatus = overrides.syncStatus ?? null
  meta.lastError = overrides.lastError ?? null
  await meta.save()
  return meta
}

// ---------------------------------------------------------------------------
// GET /api/sync/yandex/status
// ---------------------------------------------------------------------------

test.group('GET /api/sync/yandex/status', (group) => {
  group.each.setup(() => cleanMeta())

  test('200 с полями syncStatus, errorContext и датами', async ({ client, assert }) => {
    const today = DateTime.now().startOf('day')
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: today.minus({ days: 7 }),
      currentSyncDate: today.minus({ days: 7 }),
      lastSyncAt: today,
    })

    const response = await client.get('/api/sync/yandex/status')

    response.assertStatus(200)
    response.assertBodyContains({ syncStatus: 'success' })

    const body = response.body()
    assert.properties(body, [
      'syncStatus',
      'syncStartDate',
      'currentSyncDate',
      'lastSyncAt',
      'lastError',
      'errorContext',
    ])
    assert.isNull(body.errorContext) // success → null
  })

  test('200 при отсутствии записи в БД (null статус)', async ({ client, assert }) => {
    // Нет записи в integration_metadata
    const response = await client.get('/api/sync/yandex/status')
    response.assertStatus(200)

    const body = response.body()
    assert.isNull(body.syncStatus)
    assert.isNull(body.syncStartDate)
    assert.isNull(body.errorContext)
  })

  // ---------------------------------------------------------------------------
  // errorContext матрица
  // ---------------------------------------------------------------------------

  test('errorContext=token_error когда lastError startsWith "token_error:"', async ({
    client,
    assert,
  }) => {
    await setupMeta({
      syncStatus: 'error',
      lastError: 'token_error: токен истёк',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 3 }),
    })

    const response = await client.get('/api/sync/yandex/status')
    response.assertStatus(200)
    assert.equal(response.body().errorContext, 'token_error')
  })

  test('errorContext=daily_error когда currentSyncDate==syncStartDate и статус error', async ({
    client,
    assert,
  }) => {
    const startDate = DateTime.now().minus({ days: 7 }).startOf('day')
    await setupMeta({
      syncStatus: 'error',
      lastError: 'some daily error',
      syncStartDate: startDate,
      currentSyncDate: startDate, // совпадают → daily_error
    })

    const response = await client.get('/api/sync/yandex/status')
    response.assertStatus(200)
    assert.equal(response.body().errorContext, 'daily_error')
  })

  test('errorContext=initial_error когда currentSyncDate!=syncStartDate и статус error', async ({
    client,
    assert,
  }) => {
    const startDate = DateTime.now().minus({ days: 14 }).startOf('day')
    const currentDate = DateTime.now().minus({ days: 7 }).startOf('day') // не совпадает
    await setupMeta({
      syncStatus: 'error',
      lastError: 'some initial error',
      syncStartDate: startDate,
      currentSyncDate: currentDate,
    })

    const response = await client.get('/api/sync/yandex/status')
    response.assertStatus(200)
    assert.equal(response.body().errorContext, 'initial_error')
  })

  test('errorContext=null когда статус success', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.get('/api/sync/yandex/status')
    response.assertStatus(200)
    assert.isNull(response.body().errorContext)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sync/yandex/initial — матрица статусов
// ---------------------------------------------------------------------------

test.group('POST /api/sync/yandex/initial', (group) => {
  group.each.setup(() => cleanMeta())

  test('202 при статусе null (первый запуск) — возвращает jobId', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: null,
      syncStartDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(202)

    const body = response.body()
    assert.property(body, 'jobId')
    assert.property(body, 'message')
  })

  test('423 при статусе pending', async ({ client, assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(423)
    assert.equal(response.body().error, 'sync_locked')
  })

  test('409 при статусе partial (нужно использовать /continuation)', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'partial',
      syncStartDate: DateTime.now().minus({ days: 14 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(409)
    assert.equal(response.body().error, 'initial_not_allowed')
  })

  test('409 при статусе success (синхронизация уже завершена)', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(409)
    assert.equal(response.body().error, 'initial_not_allowed')
  })

  test('409 при статусе error (нужно использовать /continuation)', async ({ client }) => {
    await setupMeta({
      syncStatus: 'error',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 3 }),
    })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(409)
  })

  test('422 если syncStartDate не установлен', async ({ client, assert }) => {
    await setupMeta({ syncStatus: null, syncStartDate: null })

    const response = await client.post('/api/sync/yandex/initial')
    response.assertStatus(422)
    assert.equal(response.body().error, 'sync_date_not_configured')
  })
})

// ---------------------------------------------------------------------------
// POST /api/sync/yandex/daily — матрица статусов
// ---------------------------------------------------------------------------

test.group('POST /api/sync/yandex/daily', (group) => {
  group.each.setup(() => cleanMeta())

  test('202 при статусе success', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/daily')
    response.assertStatus(202)
    assert.property(response.body(), 'jobId')
  })

  test('202 при статусе partial', async ({ client }) => {
    await setupMeta({
      syncStatus: 'partial',
      syncStartDate: DateTime.now().minus({ days: 14 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/daily')
    response.assertStatus(202)
  })

  test('423 при статусе pending', async ({ client, assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const response = await client.post('/api/sync/yandex/daily')
    response.assertStatus(423)
    assert.equal(response.body().error, 'sync_locked')
  })

  test('409 при статусе null (сначала нужна initial sync)', async ({ client, assert }) => {
    await setupMeta({ syncStatus: null })

    const response = await client.post('/api/sync/yandex/daily')
    response.assertStatus(409)
    assert.equal(response.body().error, 'daily_not_allowed')
  })

  test('409 при статусе error (использовать /continuation)', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'error',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 3 }),
    })

    const response = await client.post('/api/sync/yandex/daily')
    response.assertStatus(409)
    assert.equal(response.body().error, 'daily_not_allowed')
  })
})

// ---------------------------------------------------------------------------
// POST /api/sync/yandex/continuation — матрица статусов
// ---------------------------------------------------------------------------

test.group('POST /api/sync/yandex/continuation', (group) => {
  group.each.setup(() => cleanMeta())

  test('202 при статусе null — запускает initial', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: null,
      syncStartDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/continuation')
    response.assertStatus(202)
    assert.property(response.body(), 'jobId')
  })

  test('202 при статусе partial — продолжает initial через daily', async ({ client }) => {
    await setupMeta({
      syncStatus: 'partial',
      syncStartDate: DateTime.now().minus({ days: 14 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/continuation')
    response.assertStatus(202)
  })

  test('202 при статусе error — запускает continuation', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'error',
      lastError: 'some error',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 3 }),
    })

    const response = await client.post('/api/sync/yandex/continuation')
    response.assertStatus(202)
    assert.property(response.body(), 'jobId')
  })

  test('423 при статусе pending', async ({ client, assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const response = await client.post('/api/sync/yandex/continuation')
    response.assertStatus(423)
    assert.equal(response.body().error, 'sync_locked')
  })

  test('409 при статусе success (использовать /daily)', async ({ client, assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const response = await client.post('/api/sync/yandex/continuation')
    response.assertStatus(409)
    assert.equal(response.body().error, 'continuation_not_allowed')
  })
})
