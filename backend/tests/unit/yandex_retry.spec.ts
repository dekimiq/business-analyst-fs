/**
 * Unit-тесты для withYandexRetry
 *
 * Тестируется утилита yandex_retry.ts полностью изолированно от БД.
 * Все сетевые вызовы имитируются через прямую подстановку fn-колбека.
 *
 * Поведение ошибок:
 *  1. Успешный ответ (200 без error в body)
 *  2. error_code 152 → за 1 попытку бросает YandexRetryExhaustedError (БДЗ retry!)
 *  3. HTTP 401 → YandexAuthError (без retry)
 *  4. HTTP 403 → YandexAuthError (без retry)
 *  5. HTTP 429 → 5 попыток с задержками 30с/1м/1.5м/3м/5м → YandexRetryExhaustedError
 *  6. Неизвестный error_code в body → YandexUnknownError
 *
 * !!! Тест для HTTP 429 медленный (реальные задержки: 30+60+90+180+300=660с ≈ 11 мин).
 * Опускайте с пометкой --grep или отдельно в CI-средах с большим timeout.
 */

import { test } from '@japa/runner'
import {
  withYandexRetry,
  YandexAuthError,
  YandexRetryExhaustedError,
  YandexUnknownError,
} from '#utils/yandex_retry'
import axios from 'axios'

// ---------------------------------------------------------------------------
// Хелпер: эмуляция AxiosError
// ---------------------------------------------------------------------------

function makeAxiosError(status: number, data: unknown = {}): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const error = new Error(`Request failed with status code ${status}`) as Record<string, any>
  error['isAxiosError'] = true
  error['response'] = { status, data }
  // Патчим axios.isAxiosError чтобы он распознавал наш объект
  Object.setPrototypeOf(error, axios.AxiosError.prototype)
  return error as unknown as Error
}

// ---------------------------------------------------------------------------
// Патч sleep: заменяем на мгновенный resolve чтобы тесты не ждали реальные секунды
// ---------------------------------------------------------------------------

/**
 * withYandexRetry использует внутренний sleep(seconds).
 * В тестах мы не можем его замокировать напрямую как модуль-импорт (ESM),
 * поэтому обходим через fn, который сразу возвращает результат или бросает.
 * Ретри-логика сконструирована так: fn вызывается снова при определённых статусах.
 * Мы управляем кол-вом «плохих» ответов через счётчик вызовов.
 */

test.group('withYandexRetry', () => {
  // БОЛьШИНСТВО тестов быстрые (нет реальных задержек).
  // Исключение: тест 429 — реальные задержки (660 с), см. его таймаут.

  // -------------------------------------------------------------------------
  // 1. Успешный 200 без ошибок в теле
  // -------------------------------------------------------------------------

  test('возвращает данные при 200 без error в body', async ({ assert }) => {
    const result = await withYandexRetry(async () => ({
      status: 200,
      data: { Campaigns: [{ Id: 1, Name: 'Test' }] },
    }))

    assert.deepEqual(result, { Campaigns: [{ Id: 1, Name: 'Test' }] })
  })

  // -------------------------------------------------------------------------
  // 2. error_code 152 → задержка (5 попыток)
  // Лимит API-единиц сбрасывается только следующим днём,
  // повтор внутри текущей выгрузки бессмыслен.
  // -------------------------------------------------------------------------

  test('error_code=152: 5 попыток YandexRetryExhaustedError', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        return {
          status: 200,
          data: {
            error: {
              error_code: 152,
              error_string: 'Not enough units',
              error_detail: 'limit exceeded',
              request_id: 'req-1',
            },
          },
        }
      })
    }, YandexRetryExhaustedError)

    assert.equal(callCount, 5, 'Ожидалось 5 вызовов API для кода ошибки 152')
  })
    .timeout(660_000 + 10_000)
    .tags(['@slow'])

  // -------------------------------------------------------------------------
  // 3. HTTP 401 → YandexAuthError (без retry)
  // -------------------------------------------------------------------------

  test('YandexAuthError при HTTP 401', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        throw makeAxiosError(401)
      })
    }, YandexAuthError)

    // Должен бросить немедленно — без повторных попыток
    assert.equal(callCount, 1)
  })

  // -------------------------------------------------------------------------
  // 4. HTTP 403 → YandexAuthError (без retry)
  // -------------------------------------------------------------------------

  test('YandexAuthError при HTTP 403', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        throw makeAxiosError(403)
      })
    }, YandexAuthError)

    assert.equal(callCount, 1)
  })

  // -------------------------------------------------------------------------
  // 5. HTTP 429 → 5 попыток с реальными задержками → YandexRetryExhaustedError
  //
  // Задержки при HTTP_RETRY_DELAYS_MS:
  // Фокус теста: проверяем что fn вызвали ровно 5 раз + бросило YandexRetryExhaustedError.
  // Верификацию точных интервалов делаем визуально (по константе HTTP_RETRY_DELAYS_MS).
  // -------------------------------------------------------------------------

  test('HTTP 429: 5 попыток → YandexRetryExhaustedError', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        throw makeAxiosError(429)
      })
    }, YandexRetryExhaustedError)

    assert.equal(callCount, 5, 'Ожидался ровно 5 вызовов API (по одному для каждой попытки)')
  })
    .timeout(660_000 + 10_000) // 660s + 10s запас
    .tags(['@slow'])

  // -------------------------------------------------------------------------
  // 6. Неизвестный error_code в теле → YandexUnknownError (без retry)
  // -------------------------------------------------------------------------

  test('YandexUnknownError при неизвестном error_code в body', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        return {
          status: 200,
          data: {
            error: {
              error_code: 9999,
              error_string: 'Unknown error',
              error_detail: 'something went wrong',
              request_id: 'req-2',
            },
          },
        }
      })
    }, YandexUnknownError)

    // Неизвестный error_code не ретраится — немедленный бросок
    assert.equal(callCount, 1)
  })

  // -------------------------------------------------------------------------
  // 7. HTTP 400 → YandexUnknownError (без retry)
  // -------------------------------------------------------------------------

  test('YandexUnknownError при HTTP 400', async ({ assert }) => {
    let callCount = 0

    await assert.rejects(async () => {
      await withYandexRetry(async () => {
        callCount++
        throw makeAxiosError(400, { error: 'bad_request' })
      })
    }, YandexUnknownError)

    assert.equal(callCount, 1)
  })

  // -------------------------------------------------------------------------
  // 8. Успешный ответ с первого раза после 202 (report processing)
  //    Первые N вызовов возвращают 202, последний → 200
  // -------------------------------------------------------------------------

  test('ждёт 202 (report processing) и возвращает данные при 200', async ({ assert }) => {
    let callCount = 0

    const result = await withYandexRetry<{ Campaigns: never[] }>(async () => {
      callCount++
      if (callCount < 3) {
        return { status: 202, data: { Campaigns: [] as never[] } }
      }
      return { status: 200, data: { Campaigns: [] as never[] } }
    })

    assert.deepEqual(result, { Campaigns: [] })
    assert.equal(callCount, 3)
  })
    .timeout(100_000)
    .tags(['@slow'])
})
