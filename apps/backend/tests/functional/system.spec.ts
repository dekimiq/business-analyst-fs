/// <reference types="@japa/api-client" />
/// <reference types="@japa/assert" />
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'

async function cleanDatabase() {
  await db.rawQuery('TRUNCATE TABLE backend.integration_metadata RESTART IDENTITY CASCADE')
}

import nock from 'nock'

test.group('System Actions (Functional)', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.enableNetConnect(/127\.0\.0\.1|localhost|0\.0\.0\.0/)
    await cleanDatabase()
    await IntegrationMetadata.createMany([{ source: 'yandex' }, { source: 'amocrm' }])
  })

  test('POST /system/sync-start-date - успех с валидной датой (обновляет все источники)', async ({
    client,
    assert,
  }) => {
    const twoYearsAgo = DateTime.now().minus({ years: 2 }).toISODate()
    const response = await client.post('/system/sync-start-date').json({
      sync_start_date: twoYearsAgo,
    })

    response.assertStatus(200)
    response.assertBodyContains({
      status: 'ok',
      message: 'Глобальная дата начала синхронизации установлена',
    })

    const yandex = await IntegrationMetadata.findByOrFail('source', 'yandex')
    assert.equal(yandex.syncStartDate?.toISODate(), twoYearsAgo)

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    assert.equal(amocrm.syncStartDate?.toISODate(), twoYearsAgo)
  })

  test('POST /system/sync-start-date - ошибка если дата на сегодня или в будущем', async ({
    client,
  }) => {
    const today = DateTime.now().toISODate()
    const future = DateTime.now().plus({ days: 1 }).toISODate()

    const resToday = await client.post('/system/sync-start-date').json({ sync_start_date: today })
    resToday.assertStatus(400)
    resToday.assertBodyContains({ status: 'error' })

    const resFuture = await client.post('/system/sync-start-date').json({ sync_start_date: future })
    resFuture.assertStatus(400)
    resFuture.assertBodyContains({ status: 'error' })
  })

  test('POST /system/sync-start-date - ошибка если дата слишком старая (> 3 лет)', async ({
    client,
  }) => {
    const tooOld = DateTime.now().minus({ years: 3, days: 1 }).toISODate()
    const response = await client.post('/system/sync-start-date').json({ sync_start_date: tooOld })
    response.assertStatus(400)
    response.assertBodyContains({ status: 'error' })
  })

  test('POST /system/force-sync/:source - ошибка если источник не найден', async ({ client }) => {
    const response = await client.post('/system/force-sync/unknown_source')
    response.assertStatus(404)
    response.assertBodyContains({ status: 'error', message: "Источник 'unknown_source' не найден" })
  })

  test('POST /system/notifications/test - успешная постановка в очередь', async ({ client }) => {
    const response = await client.post('/system/notifications/test').json({
      module: 'test-functional',
      message: 'Привет от теста!',
    })
    response.assertStatus(200)
    response.assertBodyContains({
      status: 'ok',
      message: 'Тестовое уведомление поставлено в очередь',
    })
  })

  test('POST /system/sync-start-date - ошибка 400, если дата уже установлена (включая amocrm)', async ({
    client,
  }) => {
    // amocrm уже имеет дату
    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    amocrm.syncStartDate = DateTime.fromISO('2024-01-01')
    await amocrm.save()

    const response = await client.post('/system/sync-start-date').json({
      sync_start_date: '2025-01-01',
    })

    response.assertStatus(400)
    response.assertBodyContains({
      status: 'error',
      message: 'Дата начала синхронизации уже установлена для amocrm',
    })
  })
})
