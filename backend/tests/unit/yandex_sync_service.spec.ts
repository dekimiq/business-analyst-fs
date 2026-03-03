/**
 * Unit-тесты для YandexSyncService
 *
 * Охватывают:
 *  — initialSync: happy path, partial (ошибка 152), auth error, resume из partial
 *  — dailySync: happy path, auth error
 *  — continueFromError: переход error → partial → dailySync
 *  — Адаптивные периоды (syncPeriodAdaptive): дробление 30→14→success,
 *    все шаги провалились → partial, clamp по syncStartDate
 *
 * БД изолируется через DELETE в beforeEach (без глобальной транзакции,
 * т.к. syncStructuralData использует собственную db.transaction).
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata from '#models/integration_metadata'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import DailyStat from '#models/daily_stat'
import { YandexSyncService, SyncLockedError, YandexFatalError } from '#services/yandex_sync_service'
import { YandexAuthError, YandexRetryExhaustedError } from '#utils/yandex_retry'
import { ControllableYandexMock } from '../helpers/controllable_yandex_mock.js'
import type {
  YandexCampaign,
  YandexAdGroup,
  YandexAd,
  YandexDailyStat,
} from '../../app/types/yandex.js'

// ---------------------------------------------------------------------------
// Фабрика стандартных данных
// ---------------------------------------------------------------------------

/** 10 кампаний */
const CAMPAIGNS: YandexCampaign[] = Array.from({ length: 10 }, (_, i) => ({
  Id: 1000 + i,
  Name: `Кампания ${i + 1}`,
  Type: 'TEXT_CAMPAIGN',
  Status: 'ACCEPTED',
  State: 'ON',
}))

/** 20 групп (по 2 на кампанию) */
const AD_GROUPS: YandexAdGroup[] = CAMPAIGNS.flatMap((c, ci) => [
  { Id: 2000 + ci * 2, Name: `Группа A ${ci}`, CampaignId: c.Id },
  { Id: 2001 + ci * 2, Name: `Группа B ${ci}`, CampaignId: c.Id },
])

/** 10 объявлений (по 1 на первые 10 групп) */
const ADS: YandexAd[] = AD_GROUPS.slice(0, 10).map((g, i) => ({
  Id: 3000 + i,
  AdGroupId: g.Id,
  Type: 'TEXT_AD',
  State: 'ON',
  Status: 'ACCEPTED',
  TextAd: { Title: `Заголовок ${i}`, Text: `Текст ${i}` },
}))

/** Генератор статов для одного дня (1 запись на объявление) */
function makeStats(date: string): YandexDailyStat[] {
  return ADS.map((ad) => ({
    Date: date,
    AdId: ad.Id,
    Impressions: 100,
    Clicks: 5,
    Cost: 750_000, // микроны → 0.75 руб
    Ctr: 5.0,
    AvgCpc: 150_000, // микроны → 0.15 руб
    AvgCpm: 7_500, // микроны
  }))
}

/** Генератор статов для диапазона дат (включительно) */
function makeStatsRange(dateFrom: DateTime, dateTo: DateTime): YandexDailyStat[] {
  const results: YandexDailyStat[] = []
  let current = dateFrom.startOf('day')
  const end = dateTo.startOf('day')
  while (current <= end) {
    results.push(...makeStats(current.toISODate()!))
    current = current.plus({ days: 1 })
  }
  return results
}

// ---------------------------------------------------------------------------
// Хелпер: очистка всех таблиц между тестами
// ---------------------------------------------------------------------------

async function cleanDatabase() {
  // Один TRUNCATE быстрее 5 последовательных DELETE и не требует соблюдать порядок FK-зависимостей
  await db.rawQuery(
    'TRUNCATE TABLE daily_stats, ads, ad_groups, campaigns, integration_metadata RESTART IDENTITY CASCADE'
  )
}

// ---------------------------------------------------------------------------
// Хелпер: создать мета-запись с нужными полями
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
// Хелпер: получить свежую версию мета из БД
// ---------------------------------------------------------------------------

async function freshMeta(): Promise<IntegrationMetadata> {
  const meta = await IntegrationMetadata.findByOrFail('source', 'yandex')
  return meta
}

// ---------------------------------------------------------------------------
// Тест-группа 1: initialSync — счастливый путь
// ---------------------------------------------------------------------------

test.group('YandexSyncService.initialSync — happy path', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(60_000))

  test('загружает кампании, группы, объявления и статистику за 7 дней', async ({ assert }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 7 })

    await setupMeta({ syncStartDate })

    const mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS

    for (let i = 0; i < 7; i++) {
      const day = today.minus({ days: i + 1 })
      mock.dailyStatsBehavior.set(day.toISODate()!, makeStats(day.toISODate()!))
    }

    mock.dailyStatsBehavior.set(syncStartDate.toISODate()!, makeStats(syncStartDate.toISODate()!))

    const service = new YandexSyncService(mock)
    await service.initialSync()

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'success')
    assert.equal(meta.structuralSyncPhase, 'done')
    assert.isNotNull(meta.currentSyncDate)
    assert.isNotNull(meta.lastSyncAt)

    const campaignCount = await Campaign.query().where('source', 'yandex').count('* as total')
    assert.equal(Number(campaignCount[0].$extras.total), 10)

    const adGroupCount = await AdGroup.query().where('source', 'yandex').count('* as total')
    assert.equal(Number(adGroupCount[0].$extras.total), 20)

    const adCount = await Ad.query().where('source', 'yandex').count('* as total')
    assert.equal(Number(adCount[0].$extras.total), 10)

    const statCount = await DailyStat.query().count('* as total')
    assert.isAbove(Number(statCount[0].$extras.total), 0)

    assert.equal(mock.callCount.getCampaigns, 1)
    assert.equal(mock.callCount.getAdGroups, 1)
    assert.equal(mock.callCount.getAds, 1)
    assert.isAbove(mock.callCount.getDailyStats, 0)
  })

  test('после success — повторный запуск бросает SyncLockedError', async ({ assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, SyncLockedError)
  })

  test('при pending — бросает SyncLockedError', async ({ assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, SyncLockedError)
  })

  test('без syncStartDate — бросает YandexFatalError до начала загрузки', async ({ assert }) => {
    await setupMeta({ syncStatus: null, syncStartDate: null })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, YandexFatalError)

    // Статус не должен изменился (не зашли в pending)
    const meta = await freshMeta()
    // После YandexFatalError до pending-перехода – meta.syncStatus остался null
    // (ошибка брошена ДО meta.syncStatus = 'pending')
    assert.isNull(meta.syncStatus)
  }).timeout(10_000)

  test('ошибка при Changes.check (getServerTimestamp) кидает fatal-ошибку → status error', async ({
    assert,
  }) => {
    await setupMeta({ syncStartDate: DateTime.now().minus({ days: 7 }) })

    const mock = new ControllableYandexMock()
    mock.getServerTimestamp = async () => {
      throw new YandexFatalError('Timestamp error')
    }

    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, YandexFatalError)

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'error')
    assert.isNull(meta.lastTimestamp)
    assert.isTrue(meta.lastError?.includes('Timestamp error'))
  }).timeout(10_000)
})

// ---------------------------------------------------------------------------
// Тест-группа 2: initialSync — ошибка 152 (YandexRetryExhaustedError)
// ---------------------------------------------------------------------------

test.group('YandexSyncService.initialSync — partial при YandexRetryExhaustedError', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(60_000))

  test('partial при YandexRetryExhaustedError на 2-й неделе из 2-х', async ({ assert }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 14 })

    await setupMeta({ syncStartDate })

    const mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS

    // Дни 1–7 от today: успешные данные
    for (let i = 1; i <= 7; i++) {
      const day = today.minus({ days: i })
      mock.dailyStatsBehavior.set(day.toISODate()!, makeStats(day.toISODate()!))
    }

    // Дни 8–14: бросаем YandexRetryExhaustedError при первом вызове getDailyStats в этом диапазоне
    // Имитируем через override — если диапазон захватывает дни старше 7
    mock.getDailyStatsOverride = async ({ dateFrom }) => {
      const daysDiff = today.diff(dateFrom, 'days').days
      if (daysDiff > 7) {
        throw new YandexRetryExhaustedError('limitsExhausted')
      }
      return makeStatsRange(dateFrom, dateFrom.plus({ days: 6 }))
    }

    const service = new YandexSyncService(mock)

    // Ожидаем что initialSync выбросит ошибку (пробрасывает её наружу)
    await assert.rejects(async () => {
      await service.initialSync()
    })

    const meta = await freshMeta()

    // После нефатальной ошибки (YandexRetryExhaustedError) → partial
    assert.equal(meta.syncStatus, 'partial')
    assert.isNotNull(meta.lastError)
    assert.isNotNull(meta.currentSyncDate) // прогресс сохранён
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 3: initialSync — ошибка авторизации
// ---------------------------------------------------------------------------

test.group('YandexSyncService.initialSync — YandexAuthError', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(30_000))

  test('error + token_error при YandexAuthError в getCampaigns', async ({ assert }) => {
    await setupMeta({ syncStartDate: DateTime.now().minus({ days: 7 }) })

    const mock = new ControllableYandexMock()
    // Переопределяем getCampaigns чтобы бросил YandexAuthError
    mock.getCampaigns = async () => {
      mock.callCount.getCampaigns++
      throw new YandexAuthError()
    }

    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, YandexAuthError)

    const meta = await freshMeta()

    // Токен-ошибка → status='error', НЕ partial
    assert.equal(meta.syncStatus, 'error')
    assert.isTrue(meta.lastError?.startsWith('token_error:'))

    // Ничего не должно быть записано в структурные таблицы
    const campaignCount = await Campaign.query().count('* as total')
    assert.equal(Number(campaignCount[0].$extras.total), 0)

    const adGroupCount = await AdGroup.query().count('* as total')
    assert.equal(Number(adGroupCount[0].$extras.total), 0)

    const adCount = await Ad.query().count('* as total')
    assert.equal(Number(adCount[0].$extras.total), 0)
  })

  test('error + token_error при YandexAuthError в getDailyStats', async ({ assert }) => {
    await setupMeta({ syncStartDate: DateTime.now().minus({ days: 3 }) })

    const mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS

    // Структура грузится, но статистика — auth error
    mock.getDailyStatsOverride = async () => {
      throw new YandexAuthError()
    }

    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    }, YandexAuthError)

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'error')
    assert.isTrue(meta.lastError?.startsWith('token_error:'))
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 4: initialSync — Resume из partial
// ---------------------------------------------------------------------------

test.group('YandexSyncService.initialSync — Resume из partial', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(60_000))

  test('пропускает загрузку структуры если currentSyncDate уже установлен (resume)', async ({
    assert,
  }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 14 })
    const currentSyncDate = today.minus({ days: 7 }) // половина уже загружена

    // Предустанавливаем состояние resume
    await setupMeta({ syncStatus: 'partial', syncStartDate, currentSyncDate })

    // Заполняем БД структурными данными (как будто первый запуск уже загрузил их)
    await db.table('campaigns').insert(
      CAMPAIGNS.slice(0, 3).map((c) => ({
        campaign_id: c.Id,
        source: 'yandex',
        name: c.Name,
        type: c.Type ?? null,
        status: c.Status ?? null,
        state: c.State ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )

    const mock = new ControllableYandexMock()
    // Заполняем дни от currentSyncDate до syncStartDate
    for (let i = 1; i <= 7; i++) {
      const day = currentSyncDate.minus({ days: i })
      if (day >= syncStartDate) {
        mock.dailyStatsBehavior.set(day.toISODate()!, makeStats(day.toISODate()!))
      }
    }
    // Также syncStartDate
    mock.dailyStatsBehavior.set(syncStartDate.toISODate()!, makeStats(syncStartDate.toISODate()!))

    const service = new YandexSyncService(mock)
    await service.initialSync()

    // Структура НЕ запрашивалась (getCampaigns не вызывался)
    assert.equal(mock.callCount.getCampaigns, 0)
    assert.equal(mock.callCount.getAdGroups, 0)
    assert.equal(mock.callCount.getAds, 0)

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'success')
  }).timeout(60_000)

  test('ошибка при getAdGroups переводит в partial. Следующий запуск начинает с adGroups', async ({
    assert,
  }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 7 })

    await setupMeta({ syncStartDate })

    let mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    // Падает на получении групп:
    mock.getAdGroups = async () => {
      mock.callCount.getAdGroups++
      throw new Error('ad_groups_failed')
    }

    let service = new YandexSyncService(mock)

    // 1-й запуск
    await assert.rejects(async () => {
      await service.initialSync()
    })

    let meta = await freshMeta()
    assert.equal(meta.syncStatus, 'partial', 'Должно упасть в partial из-за ошибки')
    assert.equal(meta.structuralSyncPhase, 'adGroups', 'Фаза должна остановиться на adGroups')

    // Проверяем что только кампании загрузились
    const campaignCount = await Campaign.query().count('* as total')
    assert.equal(Number(campaignCount[0].$extras.total), 10)
    const adGroupCount = await AdGroup.query().count('* as total')
    assert.equal(Number(adGroupCount[0].$extras.total), 0)

    // 2-й запуск (исправленный мок)
    mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS
    for (let i = 0; i < 7; i++) {
      const day = today.minus({ days: i + 1 })
      mock.dailyStatsBehavior.set(day.toISODate()!, makeStats(day.toISODate()!))
    }
    mock.dailyStatsBehavior.set(syncStartDate.toISODate()!, makeStats(syncStartDate.toISODate()!))

    service = new YandexSyncService(mock)
    await service.initialSync()

    meta = await freshMeta()

    assert.equal(meta.syncStatus, 'success')
    assert.equal(meta.structuralSyncPhase, 'done')
    assert.equal(mock.callCount.getCampaigns, 0)
    assert.equal(mock.callCount.getAdGroups, 1)

    const adGroupCountAfter = await AdGroup.query().count('* as total')
    assert.equal(Number(adGroupCountAfter[0].$extras.total), 20)
  }).timeout(60_000)
})

// ---------------------------------------------------------------------------
// Тест-группа 5: dailySync — счастливый путь
// ---------------------------------------------------------------------------

test.group('YandexSyncService.dailySync — happy path', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(30_000))

  test('загружает статистику за вчера, обновляет lastSyncAt', async ({ assert }) => {
    const today = DateTime.now().startOf('day')
    const yesterday = today.minus({ days: 1 })

    await setupMeta({
      syncStatus: 'success',
      syncStartDate: today.minus({ days: 7 }),
      currentSyncDate: today.minus({ days: 7 }),
    })

    // Предзаполняем ads в БД (нужны для сопоставления adId → internal pk)
    for (let i = 0; i < 3; i++) {
      await db.table('campaigns').insert({
        campaign_id: CAMPAIGNS[i].Id,
        source: 'yandex',
        name: CAMPAIGNS[i].Name,
        type: null,
        status: null,
        state: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
    const campaignRows = await db.from('campaigns').select('*')

    for (let i = 0; i < 3; i++) {
      await db.table('ad_groups').insert({
        group_id: AD_GROUPS[i].Id,
        campaign_id: campaignRows[i].id,
        source: 'yandex',
        name: AD_GROUPS[i].Name,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
    const adGroupRows = await db.from('ad_groups').select('*')

    const adIds: number[] = []
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .table('ads')
        .insert({
          ad_id: ADS[i].Id,
          group_id: adGroupRows[i].id,
          source: 'yandex',
          title: null,
          text: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
      adIds.push(row.id)
    }

    const mock = new ControllableYandexMock()
    mock.dailyStatsBehavior.set(yesterday.toISODate()!, makeStats(yesterday.toISODate()!))

    const service = new YandexSyncService(mock)
    await service.dailySync()

    const meta = await freshMeta()
    assert.isNotNull(meta.lastSyncAt)

    // Хотя mock.ads = [] (не трогаем структуру), статистика за вчера должна загрузиться
    // для тех ads что мы вручную создали (первые 3 из ADS)
    const statsCount = await DailyStat.query().whereIn('ad_id', adIds).count('* as total')
    assert.isAbove(Number(statsCount[0].$extras.total), 0)
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 6: dailySync — ошибка авторизации
// ---------------------------------------------------------------------------

test.group('YandexSyncService.dailySync — YandexAuthError', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(30_000))

  test('error + token_error при YandexAuthError в getDailyStats', async ({ assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const mock = new ControllableYandexMock()
    mock.getDailyStatsOverride = async () => {
      throw new YandexAuthError()
    }

    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.dailySync()
    }, YandexAuthError)

    const meta = await freshMeta()
    console.log(`[DEBUG] !--------------------------HERE1--------------------------!`)
    console.log(`[DEBUG] meta.syncStatus: ${meta.syncStatus}`)
    console.log(`[DEBUG] meta.lastError: ${meta?.lastError}`)
    assert.equal(meta.syncStatus, 'error')
    console.log(`[DEBUG] !--------------------------HERE2--------------------------!`)
    assert.isTrue(meta.lastError?.startsWith('token_error:'))
  })

  test('при pending — бросает SyncLockedError', async ({ assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.dailySync()
    }, SyncLockedError)
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 7: continueFromError
// ---------------------------------------------------------------------------

test.group('YandexSyncService.continueFromError', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(60_000))

  test('error → вызывает dailySync (getDailyStats вызывается как минимум 1 раз)', async ({
    assert,
  }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 7 })
    const yesterday = today.minus({ days: 1 })

    await setupMeta({
      syncStatus: 'error',
      lastError: 'some previous error',
      syncStartDate,
      currentSyncDate: syncStartDate, // уже загружено до syncStartDate
    })

    const mock = new ControllableYandexMock()
    mock.dailyStatsBehavior.set(yesterday.toISODate()!, makeStats(yesterday.toISODate()!))

    const service = new YandexSyncService(mock)
    await service.continueFromError()

    assert.isAbove(mock.callCount.getDailyStats, 0)

    const meta = await freshMeta()
    // Не должен остаться в error
    assert.notEqual(meta.syncStatus, 'error')
  })

  test('не-error статус → бросает SyncLockedError', async ({ assert }) => {
    await setupMeta({ syncStatus: 'success' })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.continueFromError()
    }, SyncLockedError)
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 8: Адаптивные периоды (syncPeriodAdaptive)
// ---------------------------------------------------------------------------

test.group('YandexSyncService — адаптивные периоды', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(60_000))

  /**
   * Сценарий A: 30 дней → error 152, дробим → 14 дней → успех
   */
  test('syncPeriodAdaptive: 30 дней → error 152, 14 дней → успех', async ({ assert }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 30 })

    await setupMeta({ syncStartDate })

    const mock = new ControllableYandexMock()
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS

    // Override: если диапазон > 14 дней → ошибка 152; иначе → нормальные данные
    mock.getDailyStatsOverride = async ({ dateFrom, dateTo }) => {
      const days = Math.round(dateTo.diff(dateFrom, 'days').days) + 1
      if (days > 14) {
        throw new YandexRetryExhaustedError('limitsExhausted')
      }
      return makeStatsRange(dateFrom, dateTo)
    }

    const service = new YandexSyncService(mock)
    await service.initialSync()

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'success')

    // Было минимум 2 неудачных вызова (30 дней) + успешные вызовы по 14 дней
    assert.isAbove(mock.callCount.getDailyStats, 2)
  })

  /**
   * Сценарий B: все шаги провалились (30, 14, 7, 3) → partial, прогресс сохранён
   */
  test('syncPeriodAdaptive: все шаги провалились → partial, прогресс сохранён', async ({
    assert,
  }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 60 })
    const currentSyncDate = today.minus({ days: 30 }) // первые 30 дней redan загружены

    await setupMeta({ syncStatus: 'partial', syncStartDate, currentSyncDate })

    const mock = new ControllableYandexMock()
    // Структура уже загружена (resume) — mock пустой для структуры
    mock.campaigns = CAMPAIGNS
    mock.adGroups = AD_GROUPS
    mock.ads = ADS

    // Все вызовы getDailyStats бросают исчерпание
    mock.getDailyStatsOverride = async () => {
      throw new YandexRetryExhaustedError('limitsExhausted')
    }

    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.initialSync()
    })

    const meta = await freshMeta()

    assert.equal(meta.syncStatus, 'partial')

    // Прогресс НЕ откатился — currentSyncDate остался прежним
    assert.equal(meta.currentSyncDate?.toISODate(), currentSyncDate.toISODate())

    // PERIOD_STEPS_DAYS = [30, 14, 7, 3] → 4 попытки
    assert.equal(mock.callCount.getDailyStats, 4)
  })

  /**
   * Сценарий C: clamp — период не выходит за syncStartDate
   */
  test('syncPeriodAdaptive: ostatní период обрезается по syncStartDate', async ({ assert }) => {
    const today = DateTime.now().startOf('day')
    const syncStartDate = today.minus({ days: 5 })
    const currentSyncDate = today.minus({ days: 3 }) // осталось загрузить 2 дня (дни 4–5 итп.)

    await setupMeta({ syncStatus: 'partial', syncStartDate, currentSyncDate })

    const mock = new ControllableYandexMock()

    // Запоминаем аргументы вызовов getDailyStats
    const capturedArgs: Array<{ dateFrom: string; dateTo: string }> = []
    mock.getDailyStatsOverride = async ({ dateFrom, dateTo }) => {
      capturedArgs.push({
        dateFrom: dateFrom.toISODate()!,
        dateTo: dateTo.toISODate()!,
      })
      return makeStatsRange(dateFrom, dateTo)
    }

    const service = new YandexSyncService(mock)
    await service.initialSync()

    const meta = await freshMeta()
    assert.equal(meta.syncStatus, 'success')

    // Все вызовы getDailyStats должны иметь dateFrom >= syncStartDate
    for (const args of capturedArgs) {
      assert.isAtLeast(
        DateTime.fromISO(args.dateFrom).toMillis(),
        syncStartDate.toMillis(),
        `dateFrom ${args.dateFrom} должен быть >= syncStartDate ${syncStartDate.toISODate()}`
      )
    }

    // хотя бы один вызов с dateFrom = syncStartDate (последний clamp)
    const clampedCall = capturedArgs.find((a) => a.dateFrom === syncStartDate.toISODate())
    assert.isNotNull(clampedCall)
  })
})

// ---------------------------------------------------------------------------
// Тест-группа 9: checkDataAvailability
// ---------------------------------------------------------------------------

test.group('YandexSyncService.checkDataAvailability', (group) => {
  group.each.setup(() => cleanDatabase())
  group.tap((t) => t.timeout(10_000))

  test('pending → бросает SyncLockedError(pending)', async ({ assert }) => {
    await setupMeta({ syncStatus: 'pending' })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.checkDataAvailability()
    }, SyncLockedError)
  })

  test('null статус → бросает SyncLockedError(null)', async ({ assert }) => {
    await setupMeta({ syncStatus: null })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    await assert.rejects(async () => {
      await service.checkDataAvailability()
    }, SyncLockedError)
  })

  test('success → availableUntil === null (данные полные)', async ({ assert }) => {
    await setupMeta({
      syncStatus: 'success',
      syncStartDate: DateTime.now().minus({ days: 7 }),
      currentSyncDate: DateTime.now().minus({ days: 7 }),
    })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    const result = await service.checkDataAvailability()

    assert.isNull(result.availableUntil)
  })

  test('partial → availableUntil = currentSyncDate (данные частичные)', async ({ assert }) => {
    const currentSyncDate = DateTime.now().minus({ days: 5 }).startOf('day')
    await setupMeta({
      syncStatus: 'partial',
      syncStartDate: DateTime.now().minus({ days: 14 }),
      currentSyncDate,
    })

    const mock = new ControllableYandexMock()
    const service = new YandexSyncService(mock)

    const result = await service.checkDataAvailability()

    assert.isNotNull(result.availableUntil)
    assert.equal(result.availableUntil?.toISODate(), currentSyncDate.toISODate())
  })
})
