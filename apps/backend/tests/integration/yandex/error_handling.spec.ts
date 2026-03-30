/**
 * @suite integration
 *
 * Тесты обработки ошибок и лимитов Яндекс.Директ.
 * Группа 5: TC-ERR-02
 */

import { test } from '@japa/runner'
import nock from 'nock'

import { YandexSyncServiceFacade } from '#services/yandex/index'
import { YandexApiClient } from '#services/yandex/api_client'
import { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'

import { cleanDatabase, reloadMeta, setupMeta, YANDEX_BASE } from './helpers.js'

function makeService() {
  const api = new YandexApiClient('test-token')
  const service = new YandexSyncServiceFacade(api)
  return { api, service }
}

test.group('YandexSyncService: Ошибки и лимиты (Группа 5)', (group: any) => {
  group.each.setup(async () => {
    nock.cleanAll()
    nock.disableNetConnect()
    await cleanDatabase()
  })

  group.each.teardown(() => {
    nock.cleanAll()
  })

  // ─────────────────────────────────────────────────────────────────────
  // TC-ERR-02: Лимиты Яндекса (200 OK + Error code 152)
  // ─────────────────────────────────────────────────────────────────────
  test('TC-ERR-02: Ошибка лимитов (152) переводит статус в PARTIAL', async ({ assert }) => {
    // 1. Предусловие
    await setupMeta({ referenceSyncPhase: ReferenceSyncPhase.TIMESTAMP })

    // 2. Действие (Mocks)
    // Ошибка на самом первом этапе (getTimestamp)
    nock(YANDEX_BASE)
      .post('/json/v5/changes')
      .reply(200, {
        error: {
          error_code: 152,
          error_string: 'The limit of requests has been exceeded',
          request_id: 'req-123',
        },
      })

    const { service } = makeService()

    // Ожидаем исключение, так как сервис пробрасывает ошибки наружу
    await assert.rejects(async () => {
      await service.sync()
    })

    // 3. Ожидание
    const meta = await reloadMeta()
    assert.equal(
      meta.syncStatus,
      SyncStatus.PARTIAL,
      'При достижении лимитов статус должен стать PARTIAL'
    )
    assert.equal(
      meta.referenceSyncPhase,
      ReferenceSyncPhase.TIMESTAMP,
      'Фаза не должна измениться, так как упали на ней'
    )
  })
})
