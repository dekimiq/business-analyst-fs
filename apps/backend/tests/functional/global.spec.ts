/// <reference types="@japa/api-client" />
/// <reference types="@japa/assert" />
import { test } from '@japa/runner'
import nock from 'nock'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'

async function cleanDatabase() {
  await db.rawQuery('TRUNCATE TABLE backend.integration_metadata RESTART IDENTITY CASCADE')
}

test.group('Global Actions (Functional)', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(/(127.0.0.1|0.0.0.0|localhost)/)
    await cleanDatabase()
  })

  group.teardown(async () => {
    nock.enableNetConnect()
  })

  test('GET /status - возвращает полную структуру и систему здоровья', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/status')

    response.assertStatus(200)
    const body = response.body()

    assert.equal(body.status, 'ok')
    assert.exists(body.data.system_health)
    assert.exists(body.data.services)
    assert.equal(body.data.system_health.database, 'ok')
  })

  test('GET /status - расчет состояния amocrm (not_configured -> pending_token -> success)', async ({
    client,
    assert,
  }) => {
    await IntegrationMetadata.create({ source: 'amocrm' })

    let res = await client.get('/status')
    assert.equal(res.body().data.services.amocrm.state, 'not_configured')

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    amocrm.credentials = {
      domain: 'test.amocrm.ru',
      client_id: 'a'.repeat(20),
      client_secret: 'b'.repeat(40),
    }
    await amocrm.save()

    res = await client.get('/status')
    assert.equal(res.body().data.services.amocrm.state, 'pending_token')
    assert.equal(res.body().data.services.amocrm.config.domain, 'test.amocrm.ru')

    amocrm.credentials = { ...amocrm.credentials, long_token: 'valid_token' }
    await amocrm.save()

    res = await client.get('/status')
    assert.equal(res.body().data.services.amocrm.state, 'ready')
  })

  test('POST /tokens/install - валидный токен Яндекс (чек пинга)', async ({ client, assert }) => {
    await IntegrationMetadata.create({ source: 'yandex' })

    nock('https://api.direct.yandex.com').post('/json/v5/campaigns').reply(200, { result: {} })

    const response = await client.post('/tokens/install').json({
      source: 'yandex',
      token: 'yandex_token_123456',
    })

    response.assertStatus(200)
    assert.equal(response.body().message, 'Токен для yandex успешно установлен и проверен')

    const yandex = await IntegrationMetadata.findByOrFail('source', 'yandex')
    assert.equal((yandex.credentials as any).long_token, 'yandex_token_123456')
  })

  test('POST /tokens/install - ошибка если AmoCRM конфиг отсутствует', async ({ client }) => {
    await IntegrationMetadata.create({ source: 'amocrm' })

    const response = await client.post('/tokens/install').json({
      source: 'amocrm',
      token: 'amo_token_123456',
    })

    response.assertStatus(400)
    response.assertBodyContains({
      status: 'error',
      message:
        'Конфигурация AmoCRM не найдена. Сначала настройте домен и ключи через /amocrm/config.',
    })
  })
})
