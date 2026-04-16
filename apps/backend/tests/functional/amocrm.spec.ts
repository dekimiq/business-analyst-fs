/// <reference types="@japa/api-client" />
/// <reference types="@japa/assert" />
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'
import nock from 'nock'

// Зададим переменные для теста
process.env.AMOCRM_CLIENT_ID = 'test_global_client_id_123'
process.env.AMOCRM_CLIENT_SECRET = 'test_global_client_secret_abc'

async function cleanDatabase() {
  await db.rawQuery('TRUNCATE TABLE backend.integration_metadata RESTART IDENTITY CASCADE')
}

test.group('AmoCRM Config (Functional)', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
    // Создаем базовую запись
    await IntegrationMetadata.create({ source: 'amocrm' })
  })

  test('POST /amocrm/setup - успешная установка и получение токенов', async ({
    client,
    assert,
  }) => {
    const payload = {
      domain: 'https://test.amocrm.ru/path/to/page?query=1',
      code: 'auth_code_123',
    }

    nock('https://test.amocrm.ru')
      .post('/oauth2/access_token', (body) => {
        return (
          body.client_id === process.env.AMOCRM_CLIENT_ID &&
          body.client_secret === process.env.AMOCRM_CLIENT_SECRET &&
          body.grant_type === 'authorization_code' &&
          body.code === payload.code
        )
      })
      .reply(200, {
        access_token: 'access_123',
        refresh_token: 'refresh_123',
      })

    const response = await client.post('/amocrm/setup').json(payload)

    response.assertStatus(200)
    response.assertBodyContains({
      status: 'ok',
      message: 'Конфигурация AmoCRM успешно установлена и токены получены',
    })

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    const creds = amocrm.credentials as any

    assert.equal(creds.domain, 'test.amocrm.ru') // нормализация сработала
    assert.isUndefined(creds.client_id)
    assert.isUndefined(creds.client_secret)
    assert.equal(creds.access_token, 'access_123')
    assert.equal(creds.refresh_token, 'refresh_123')
  })

  test('POST /amocrm/setup - ошибка валидации зоны (strict check)', async ({ client }) => {
    const response = await client.post('/amocrm/setup').json({
      domain: 'test.google.com',
      code: 'code123',
    })

    response.assertStatus(400)
    response.assertBodyContains({
      status: 'error',
      message: 'Домен должен принадлежать зоне .amocrm.ru',
    })
  })

  test('POST /amocrm/setup - ошибка пустых полей', async ({ client }) => {
    const response = await client.post('/amocrm/setup').json({})
    response.assertStatus(400)
    response.assertBodyContains({ status: 'error' })
  })

  test('POST /amocrm/setup - ошибка при обмене токенов', async ({ client, assert }) => {
    const payload = {
      domain: 'error.amocrm.ru',
      code: 'invalid_code',
    }

    nock('https://error.amocrm.ru').post('/oauth2/access_token').reply(400, {
      detail: 'Invalid grant',
    })

    const response = await client.post('/amocrm/setup').json(payload)

    response.assertStatus(400)
    response.assertBodyContains({
      status: 'error',
    })
    const body = response.body()
    assert.include(body.message, 'Invalid grant')
  })
})
