import axios from 'axios'

// ---------------------------------------------------------------------------
// Задержки (сек)
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [360, 540, 720, 900, 1080] as const
const REPORT_DELAYS_MS = [30, 60, 120, 180, 300] as const
const UNIVERSAL_DELAY_MS = 60

// ---------------------------------------------------------------------------
// Коды ошибок Яндекс API (в теле 200-ответа)
// ---------------------------------------------------------------------------

const LIMIT_API_ERROR_CODES: readonly number[] = [152, 52]

// ---------------------------------------------------------------------------
// HTTP-статусы
// ---------------------------------------------------------------------------

const RETRYABLE_HTTP_STATUSES: readonly number[] = [429, 503, 504, 506]
const FATAL_HTTP_STATUSES: readonly number[] = [400, 401, 403, 502, 500]

// ---------------------------------------------------------------------------
// Кастомные ошибки
// ---------------------------------------------------------------------------

export class YandexUnknownError extends Error {}
export class YandexRetryExhaustedError extends Error {}
export class YandexAuthError extends Error {
  constructor() {
    super('[YandexRetry] Ошибка авторизации — токен невалиден или истёк (401/403).')
    this.name = 'YandexAuthError'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

interface YandexApiErrorBody {
  error_code: number
  error_string: string
  error_detail: string
  request_id: string
}

// ---------------------------------------------------------------------------
// withYandexRetry
// ---------------------------------------------------------------------------

type RetryErrorType = 'limit' | 'network' | 'unknown' | null

export async function withYandexRetry<T>(
  fn: () => Promise<{ status: number; data: T }>
): Promise<T> {
  let attempt = 0
  let lastErrorType: RetryErrorType = null

  while (attempt < RETRY_DELAYS_MS.length) {
    try {
      const response = await fn()

      if (response.status === 200) {
        const maybeError = (response.data as { error?: YandexApiErrorBody }).error

        if (maybeError) {
          const { error_code, error_detail } = maybeError

          if (LIMIT_API_ERROR_CODES.includes(error_code)) {
            const delay = RETRY_DELAYS_MS[attempt] ?? 1080
            console.log(
              `[YandexRetry] Ошибка - недостаточно баллов ` +
                `(error_code=${error_code}), жду ${delay} сек...`
            )
            lastErrorType = 'limit'
            await sleep(delay)
            attempt++
            continue
          }
          throw new YandexUnknownError(
            `[YandexRetry] Фатальная ошибка API (error_code=${error_code}): ${error_detail}`
          )
        }
        return response.data
      }

      if (response.status === 202) {
        const delay = REPORT_DELAYS_MS[attempt] ?? 300
        console.log(`[YandexRetry] 202 — отчёт готовится, жду ${delay} сек...`)
        lastErrorType = null
        await sleep(delay)
        attempt++
        continue
      }

      if (response.status === 201) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 1080
        console.log(`[YandexRetry] 201 — отчёт в очереди, жду ${delay} сек...`)
        lastErrorType = null
        await sleep(delay)
        attempt++
        continue
      }

      throw new YandexUnknownError(
        `[YandexRetry] Неожиданный HTTP-статус ответа: ${response.status}`
      )
    } catch (error) {
      if (error instanceof YandexAuthError || error instanceof YandexUnknownError) {
        throw error
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status

        if (!error.response) {
          const delay = UNIVERSAL_DELAY_MS
          console.warn(
            `[YandexRetry] Сетевая ошибка (${error.code ?? 'NETWORK_ERROR'}), жду ${delay} сек... ` +
              `(попытка ${attempt + 1}/${RETRY_DELAYS_MS.length})`
          )
          lastErrorType = 'network'
          await sleep(delay)
          attempt++
          continue
        }

        if (status && FATAL_HTTP_STATUSES.includes(status)) {
          if (status === 401 || status === 403) {
            console.error(`[YandexRetry] ${status} — токен невалиден:`, error.response.data)
            throw new YandexAuthError()
          }

          console.error(`[YandexRetry] ${status} Bad Request:`, error.response.data)
          throw new YandexUnknownError(
            `[YandexRetry] Неверный запрос (${status}). Проверьте параметры.`
          )
        }

        if (status && RETRYABLE_HTTP_STATUSES.includes(status)) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 1080
          console.warn(
            `[YandexRetry] HTTP ${status}, жду ${delay} сек... ` +
              `(попытка ${attempt + 1}/${RETRY_DELAYS_MS.length})`
          )
          lastErrorType = 'limit'
          await sleep(delay)
          attempt++
          continue
        }

        const delay = UNIVERSAL_DELAY_MS
        console.error(
          `[YandexRetry] Неизвестный HTTP ${status}, жду ${delay} сек... ` +
            `(попытка ${attempt + 1}/${RETRY_DELAYS_MS.length})`
        )
        lastErrorType = 'unknown'
        await sleep(delay)
        attempt++
        continue
      }

      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Все 5 попыток исчерпаны
  // ---------------------------------------------------------------------------

  if (lastErrorType === 'limit') {
    throw new YandexRetryExhaustedError(
      '[YandexRetry] Все попытки исчерпаны — лимиты Яндекс API исчерпаны на сегодня.'
    )
  }

  if (lastErrorType === 'network') {
    throw new YandexRetryExhaustedError(
      '[YandexRetry] Все попытки исчерпаны — нет соединения с Яндекс API.'
    )
  }

  throw new YandexUnknownError(
    '[YandexRetry] Все попытки исчерпаны — неизвестный статус или ошибка ответа.'
  )
}
