import { test } from '@japa/runner'
import nock from 'nock'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'
import env from '#start/env'

async function cleanDatabase() {
  await db.rawQuery('TRUNCATE TABLE integration_metadata RESTART IDENTITY CASCADE')
}

async function seedIntegrations() {
  await IntegrationMetadata.createMany([
    {
      source: 'yandex',
      syncStartDate: null,
      credentials: null,
    },
    {
      source: 'amocrm',
      syncStartDate: null,
      credentials: {
        domain: null,
        client_id: null,
        client_secret: null,
      },
    },
  ])
}

test.group('IntegrationController (Functional)', (group) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    nock.enableNetConnect(`${env.get('HOST')}:${env.get('PORT')}`)
    await cleanDatabase()
    await seedIntegrations()
  })

  group.teardown(async () => {
    nock.enableNetConnect()
  })

  test('GET /status returns correct structure for all services', async ({ client, assert }) => {
    const response = await client.get('/status')

    response.assertStatus(200)
    const { result } = response.body()
    assert.exists(result.data.yandex)
    assert.exists(result.data.amocrm)
    assert.equal(result.data.yandex.status, 'not_configured')
    assert.isNull(result.error)
  })

  test('POST /sync/start-date - success with valid date', async ({ client, assert }) => {
    const twoYearsAgo = DateTime.now().minus({ years: 2 }).toISODate()
    const response = await client.post('/sync/start-date').json({
      sync_start_date: twoYearsAgo,
    })

    response.assertStatus(200)
    assert.equal(response.body().result.data, 'success')

    const yandex = await IntegrationMetadata.findByOrFail('source', 'yandex')
    assert.equal(yandex.syncStartDate?.toISODate(), twoYearsAgo)

    // AmoCRM should NOT be updated
    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    assert.isNull(amocrm.syncStartDate)
  })

  test('POST /sync/start-date - boundary values and validation', async ({ client }) => {
    const today = DateTime.now().toISODate()
    const future = DateTime.now().plus({ days: 1 }).toISODate()
    const tooOld = DateTime.now().minus({ years: 3, days: 1 }).toISODate()

    // Today is forbidden
    const resToday = await client.post('/sync/start-date').json({ sync_start_date: today })
    resToday.assertStatus(422)

    // Future is forbidden
    const resFuture = await client.post('/sync/start-date').json({ sync_start_date: future })
    resFuture.assertStatus(422)

    // Older than 3 years is forbidden
    const resOld = await client.post('/sync/start-date').json({ sync_start_date: tooOld })
    resOld.assertStatus(422)
  })

  test('POST /sync/start-date - forbidden if already set', async ({ client }) => {
    const date1 = DateTime.now().minus({ years: 1 }).toISODate()
    const date2 = DateTime.now().minus({ years: 2 }).toISODate()

    await client.post('/sync/start-date').json({ sync_start_date: date1 })
    const response = await client.post('/sync/start-date').json({ sync_start_date: date2 })

    response.assertStatus(400)
    response.assertBodyContains({ result: { error: 'sync_start_date_already_set_for_yandex' } })
  })

  test('POST /amocrm/config - success with valid config', async ({ client, assert }) => {
    const payload = {
      domain: 'mycompany.amocrm.ru',
      client_id: 'client_id_123456',
      client_secret: 'client_secret_123456',
    }

    const response = await client.post('/amocrm/config').json(payload)

    response.assertStatus(200)
    assert.equal(response.body().result.data, 'success')

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    assert.deepEqual(amocrm.credentials, payload)
  })

  test('POST /amocrm/config - validation fails for invalid domain or short strings', async ({
    client,
  }) => {
    // Missing TLD
    const res1 = await client.post('/amocrm/config').json({
      domain: 'invalid',
      client_id: '1234567890',
      client_secret: '1234567890',
    })
    res1.assertStatus(422)

    // Short strings (< 10)
    const res2 = await client.post('/amocrm/config').json({
      domain: 'test.com',
      client_id: 'short',
      client_secret: 'short',
    })
    res2.assertStatus(422)
  })

  test('POST /amocrm/config - forbidden if already exists', async ({ client }) => {
    const payload = {
      domain: 'test.amocrm.ru',
      client_id: '12345678901',
      client_secret: '12345678901',
    }

    await client.post('/amocrm/config').json(payload)
    const response = await client.post('/amocrm/config').json(payload)

    response.assertStatus(400)
    response.assertBodyContains({ result: { error: 'amocrm_config_already_exists' } })
  })

  test('POST /tokens/install - yandex success with ping', async ({ client, assert }) => {
    nock('https://api.direct.yandex.com').post('/json/v5/campaigns').reply(200, { result: {} })

    const response = await client.post('/tokens/install').json({
      source: 'yandex',
      token: 'yandex_token_123456',
    })

    response.assertStatus(200)
    assert.equal(response.body().result.data, 'success')

    const yandex = await IntegrationMetadata.findByOrFail('source', 'yandex')
    assert.equal((yandex.credentials as any)?.long_token, 'yandex_token_123456')
  })

  test('POST /tokens/install - amocrm success with ping', async ({ client, assert }) => {
    await client.post('/amocrm/config').json({
      domain: 'test.amocrm.ru',
      client_id: '12345678901',
      client_secret: '12345678901',
    })

    nock('https://test.amocrm.ru').get('/api/v4/account').reply(200, {})

    const response = await client.post('/tokens/install').json({
      source: 'amocrm',
      token: 'amo_token_123456',
    })

    response.assertStatus(200)
    assert.equal(response.body().result.data, 'success')

    const amocrm = await IntegrationMetadata.findByOrFail('source', 'amocrm')
    assert.equal((amocrm.credentials as any)?.long_token, 'amo_token_123456')
  })

  test('POST /tokens/install - fails if ping fails', async ({ client }) => {
    nock('https://api.direct.yandex.com').post('/json/v5/campaigns').reply(401)

    const response = await client.post('/tokens/install').json({
      source: 'yandex',
      token: 'invalid_token',
    })

    response.assertStatus(400)
    response.assertBodyContains({ result: { error: 'invalid_token' } })
  })

  test('POST /tokens/install - amocrm fails if config missing', async ({ client }) => {
    const response = await client.post('/tokens/install').json({
      source: 'amocrm',
      token: 'amo_token_123456',
    })

    response.assertStatus(400)
    response.assertBodyContains({ result: { error: 'amocrm_config_missing' } })
  })
})
