/**
 * @suite integration
 */
import { test } from '@japa/runner'
import IntegrationMetadata from '#models/integration_metadata'
import { DateTime } from 'luxon'
import { cleanDatabase, setupMeta } from '../amocrm/helpers.js'

test.group('System: Sync Start Date', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('Успешное сохранение даты синхронизации для AmoCRM и других источников', async ({
    client,
    assert,
  }) => {
    // 1. Подготовка: создаем метаданные для amocrm и другого источника
    await setupMeta({ source: 'amocrm', syncStartDate: null })
    await IntegrationMetadata.create({
      source: 'yandex',
      syncStartDate: null,
    })

    const startDate = '2025-01-01'

    // 2. Вызов эндпоинта
    const response = await client.post('/system/sync-start-date').json({
      sync_start_date: startDate,
    })

    // 3. Проверки
    response.assertStatus(200)

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    const yandex = await IntegrationMetadata.findByOrFail('source', 'yandex')

    assert.equal(amocrm.syncStartDate?.toISODate(), startDate)
    assert.equal(yandex.syncStartDate?.toISODate(), startDate)
  })

  test('Ошибка 400, если дата уже установлена (включая amocrm)', async ({ client }) => {
    // 1. Подготовка: amocrm уже имеет дату
    await setupMeta({ source: 'amocrm', syncStartDate: DateTime.fromISO('2024-01-01') })

    // 2. Вызов эндпоинта
    const response = await client.post('/system/sync-start-date').json({
      sync_start_date: '2025-01-01',
    })

    // 3. Проверка
    response.assertStatus(400)
    // Сообщение из ApiResponse.error(`Дата начала синхронизации уже установлена для ${integration.source}`)
    response.assertBodyContains({
      error: { message: 'Дата начала синхронизации уже установлена для amocrm' },
    })
  })
})
