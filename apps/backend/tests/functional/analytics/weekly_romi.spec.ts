import { test } from '@japa/runner'
import { DateTime, Settings } from 'luxon'
import Campaign from '#models/campaign'
import Ad from '#models/ad'
import AdGroup from '#models/ad_group'
import DailyStat from '#models/daily_stat'
import CrmRecord from '#models/crm_record'
import CrmStatus from '#models/crm_status'

test.group('Analytics | Недельный Romi отчет', (group) => {
  group.each.setup(async () => {
    // Чистим базу перед каждым тестом
    await CrmRecord.query().delete()
    await DailyStat.query().delete()
    await Ad.query().delete()
    await AdGroup.query().delete()
    await Campaign.query().delete()
    await CrmStatus.query().delete()

    // Замораживаем время на среду 01.04.2026
    // Прошлая неделя будет 23.03 - 29.03
    const mockNow = DateTime.fromISO('2026-04-01T12:00:00', { zone: 'Europe/Moscow' }).toMillis()
    const originalNow = Settings.now
    Settings.now = () => mockNow

    return () => {
      Settings.now = originalNow
    }
  })

  test('Должен вернуть корректные данные ROMI для Яндекс Директ', async ({ client }) => {
    // 1. Создаем тестовую кампанию
    const campaign = await Campaign.create({
      campaignId: 'yandex-123',
      source: 'yandex',
      name: 'Test Campaign',
    })

    const group = await AdGroup.create({
      groupId: 'group-123',
      campaignPk: campaign.id,
      source: 'yandex',
      name: 'Test Group',
    })

    const ad = await Ad.create({
      adId: 'ad-123',
      groupPk: group.id,
      source: 'yandex',
    })

    // 2. Создаем статистику за прошлую неделю (23.03 - 29.03)
    await DailyStat.create({
      adPk: ad.id,
      date: DateTime.fromISO('2026-03-25'),
      cost: 50000,
      clicks: 100,
      impressions: 1000,
    })

    // Статистика вне периода (не должна попасть)
    await DailyStat.create({
      adPk: ad.id,
      date: DateTime.fromISO('2026-03-31'),
      cost: 10000,
    })

    // 3. Создаем статусы
    const paidStatus = await CrmStatus.create({
      id: '101',
      name: 'Оплачено',
      pipelineId: '501',
      source: 'amocrm',
      sort: 1,
    })

    const leadStatus = await CrmStatus.create({
      id: '102',
      name: 'Первичный контакт',
      pipelineId: '501',
      source: 'amocrm',
      sort: 2,
    })

    // 4. Создаем лиды за прошлую неделю
    // 1 оплаченный лид (создан 24.03)
    await CrmRecord.create({
      dealId: '1001',
      campaignPk: campaign.id,
      adPk: ad.id,
      source: 'yandex',
      statusId: paidStatus.id,
      budget: 150000,
      recordCreatedAt: DateTime.fromISO('2026-03-24T10:00:00', { zone: 'Europe/Moscow' }).toUTC(),
    })

    // 1 неоплаченный лид (создан 26.03)
    await CrmRecord.create({
      dealId: '1002',
      campaignPk: campaign.id,
      adPk: ad.id,
      source: 'yandex',
      statusId: leadStatus.id,
      budget: 0,
      recordCreatedAt: DateTime.fromISO('2026-03-26T15:00:00', { zone: 'Europe/Moscow' }).toUTC(),
    })

    // Лид вне периода (не должен попасть)
    await CrmRecord.create({
      dealId: '1003',
      campaignPk: campaign.id,
      adPk: ad.id,
      source: 'yandex',
      statusId: paidStatus.id,
      budget: 200000,
      recordCreatedAt: DateTime.fromISO('2026-03-31T10:00:00', { zone: 'Europe/Moscow' }).toUTC(),
    })

    // 5. Вызываем эндпоинт
    const response = await client.get('/analytics/weekly-romi')

    // 6. Проверяем результат
    response.assertStatus(200)
    response.assertBodyContains({
      status: 'ok',
      data: {
        spend: 50000,
        leadsCount: 2,
        paymentsCount: 1,
        salesSum: 150000,
        cpl: 25000, // 50000 / 2
        cac: 50000, // 50000 / 1
        romi: 200, // ((150000 - 50000) / 50000) * 100
      },
    })
  })

  test('Должен вернуть ошибку, если нет маркетинговых данных за этот период', async ({
    client,
  }) => {
    // Не создаем никаких данных в базе

    // Вызываем эндпоинт
    const response = await client.get('/analytics/weekly-romi')

    // Проверяем результат
    response.assertStatus(200)
    response.assertBodyContains({
      status: 'error',
      message: 'Нет маркетинговых данных за этот период',
      data: null,
    })
  })
})
