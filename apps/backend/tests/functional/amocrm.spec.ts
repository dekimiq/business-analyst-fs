/// <reference types="@japa/api-client" />
/// <reference types="@japa/assert" />
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'

async function cleanDatabase() {
  await db.rawQuery('TRUNCATE TABLE backend.integration_metadata RESTART IDENTITY CASCADE')
}

test.group('AmoCRM Config (Functional)', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
    // Создаем базовую запись
    await IntegrationMetadata.create({ source: 'amocrm' })
  })

  test('POST /amocrm/config - успешная установка и нормализация URL', async ({
    client,
    assert,
  }) => {
    const payload = {
      domain: 'https://test.amocrm.ru/path/to/page?query=1',
      client_id: 'a'.repeat(20), // ровно 20
      client_secret: 'b'.repeat(40), // ровно 40
    }

    const response = await client.post('/amocrm/config').json(payload)

    response.assertStatus(200)
    response.assertBodyContains({
      status: 'ok',
      message: 'Конфигурация AmoCRM успешно установлена',
    })

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    const creds = amocrm.credentials as any

    assert.equal(creds.domain, 'test.amocrm.ru') // нормализация сработала
    assert.equal(creds.client_id, payload.client_id)
    assert.equal(creds.client_secret, payload.client_secret)
  })

  test('POST /amocrm/config - разрешена перезапись', async ({ client, assert }) => {
    // Первая установка
    await client.post('/amocrm/config').json({
      domain: 'first.amocrm.ru',
      client_id: 'id'.repeat(10),
      client_secret: 'secret'.repeat(10),
    })

    // Вторая установка (другие данные)
    const newPayload = {
      domain: 'second.amocrm.ru',
      client_id: 'new_id'.repeat(5),
      client_secret: 'new_secret'.repeat(10),
    }

    const response = await client.post('/amocrm/config').json(newPayload)
    response.assertStatus(200)

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    assert.equal((amocrm.credentials as any).domain, 'second.amocrm.ru')
  })

  test('POST /amocrm/config - ошибка валидации зоны (strict check)', async ({ client }) => {
    const response = await client.post('/amocrm/config').json({
      domain: 'test.google.com',
      client_id: 'a'.repeat(20),
      client_secret: 'b'.repeat(40),
    })

    response.assertStatus(400)
    response.assertBodyContains({
      status: 'error',
      message: 'Домен должен принадлежать зоне .amocrm.ru',
    })
  })

  test('POST /amocrm/config - ошибка слишком короткого client_id', async ({ client, assert }) => {
    const response = await client.post('/amocrm/config').json({
      domain: 'test.amocrm.ru',
      client_id: 'too_short',
      client_secret: 'b'.repeat(40),
    })

    response.assertStatus(400)
    // Проверяем формат ошибки из GlobalExceptionHandler
    response.assertBodyContains({
      status: 'error',
    })
    // Сообщение должно содержать упоминание поля
    const body = response.body()
    assert.include(body.message, 'client_id')
  })

  test('POST /amocrm/config - ошибка пустых полей', async ({ client }) => {
    const response = await client.post('/amocrm/config').json({})
    response.assertStatus(400)
    response.assertBodyContains({ status: 'error' })
  })
})
