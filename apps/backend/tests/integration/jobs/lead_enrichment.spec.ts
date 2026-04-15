import { test } from '@japa/runner'
import CrmRecord from '#models/crm_record'
import db from '@adonisjs/lucid/services/db'
import LeadEnrichmentJob from '#jobs/lead_enrichment_job'
import nock from 'nock'

test.group('Lead Enrichment Job', (group) => {
  group.each.setup(async () => {
    // Разрешаем локальные соединения, чтобы nock не блокировал внутренние вызовы если они есть
    nock.enableNetConnect(/127\.0\.0\.1|localhost/)

    // Чистим таблицы перед каждым тестом
    await db.rawQuery(
      'TRUNCATE backend.ads, backend.ad_groups, backend.campaigns, backend.crm_records RESTART IDENTITY CASCADE'
    )
  })

  test('должен успешно связать сделку с объявлением по pipe-строке в rawIds', async ({
    assert,
  }) => {
    console.log('[TEST_DEBUG] Starting success match test')
    // 1. Подготавливаем справочники Яндекса в БД
    const [campaign] = await db
      .table('backend.campaigns')
      .insert({
        campaign_id: 'camp_123',
        source: 'yandex',
        name: 'Test Campaign',
      })
      .returning('id')

    console.log('[TEST_DEBUG] Campaign created:', campaign)

    const [adGroup] = await db
      .table('backend.ad_groups')
      .insert({
        group_id: 'group_456',
        campaign_pk: campaign.id,
        source: 'yandex',
        name: 'Test Group',
      })
      .returning('id')

    console.log('[TEST_DEBUG] AdGroup created:', adGroup)

    const [ad] = await db
      .table('backend.ads')
      .insert({
        ad_id: 'ad_789',
        group_pk: adGroup.id,
        source: 'yandex',
        title: 'Test Ad',
      })
      .returning('id')

    console.log('[TEST_DEBUG] Ad created:', ad)

    // 2. Создаем необработанную сделку AmoCRM
    const record = await CrmRecord.create({
      dealId: '1001',
      rawIds: 'external_id_1|ad_789|some_other_meta',
      source: 'amocrm',
      budget: 5000,
      price: 5000,
    })

    console.log('[TEST_DEBUG] CrmRecord created:', record.id, record.rawIds, record.adPk)

    // 3. Запускаем воркер обогащения
    const job = new LeadEnrichmentJob()
    await job.handle({})

    // 4. Проверяем, что воркер нашел соответствие и заполнил все ключи
    const updated = await CrmRecord.findOrFail(record.id)

    assert.equal(updated.adPk, ad.id, 'adPk должен соответствовать ID в базе')
    assert.equal(updated.groupPk, adGroup.id, 'groupPk должен подтянуться через JOIN')
    assert.equal(updated.campaignPk, campaign.id, 'campaignPk должен подтянуться через JOIN')

    assert.equal(updated.adId, 'ad_789', 'Натуральный adId должен сохраниться')
    assert.equal(updated.groupId, 'group_456', 'Натуральный groupId должен подтянуться')
    assert.equal(updated.campaignId, 'camp_123', 'Натуральный campaignId должен подтянуться')
  })

  test('должен инкрементировать счетчик попыток, если совпадений не найдено', async ({
    assert,
  }) => {
    // 1. Создаем сделку с ID, которого нет в справочнике Яндекса
    const record = await CrmRecord.create({
      dealId: '1002',
      rawIds: 'non_existent_id',
      source: 'amocrm',
      budget: 0,
      price: 0,
    })

    // 2. Запускаем воркер
    const job = new LeadEnrichmentJob()
    await job.handle({})

    // 3. Проверяем статус повтора
    const updated = await CrmRecord.findOrFail(record.id)

    assert.equal(updated.matchRetryCount, 1, 'Retry count должен стать 1')
    assert.isNotNull(updated.nextMatchRetryAt, 'Должна быть установлена дата следующей попытки')
    assert.isNull(updated.adPk, 'Привязка не должна произойти')
  })

  test('должен корректно обрабатывать пачку сделок (Bulk Mode)', async ({ assert }) => {
    // 1. Создаем рекламу
    const [ad] = await db
      .table('backend.ads')
      .insert({
        ad_id: 'bulk_ad_1',
        group_pk: (
          await db
            .table('backend.ad_groups')
            .insert({
              group_id: 'g1',
              source: 'yandex',
              name: 'name',
              campaign_pk: (
                await db
                  .table('backend.campaigns')
                  .insert({ campaign_id: 'c1', source: 'yandex', name: 'name' })
                  .returning('id')
              )[0].id,
            })
            .returning('id')
        )[0].id,
        source: 'yandex',
        title: 'Title',
      })
      .returning('id')

    // 2. Создаем 3 сделки: одну со списком ID, одну с прямым ID, одну пустую
    await CrmRecord.create({ dealId: 'd1', rawIds: 'bulk_ad_1', budget: 0, price: 0 })
    await CrmRecord.create({ dealId: 'd2', adId: 'bulk_ad_1', budget: 0, price: 0 })
    await CrmRecord.create({ dealId: 'd3', rawIds: 'garbage', budget: 0, price: 0 })

    // 3. Запускаем воркер
    const job = new LeadEnrichmentJob()
    await job.handle({ batchSize: 10 })

    // 4. Проверяем результаты массовой обработки
    const records = await CrmRecord.query().orderBy('dealId', 'asc')

    assert.equal(records[0].adPk, ad.id, 'Первая сделка сматчилась по rawIds')
    assert.equal(records[1].adPk, ad.id, 'Вторая сделка сматчилась по adId')
    assert.equal(records[2].matchRetryCount, 1, 'Третья сделка ушла в ретрай')
  })
})
