import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'
import { amocrmRetryConfig } from '#app_config/api/amocrm_retry_config'

/**
 * Сервис повторных попыток для AmoCRM API.
 *
 * Обрабатывает:
 * - 401 Unauthorized - требуется обновление токена
 * - 429 Too Many Requests - превышен лимит запросов
 * - 500, 502, 503, 504 - серверные ошибки
 *
 * AmoCRM имеет ограничение ~7 запросов в секунду (зависит от тарифа).
 */
export class AmocrmRetryService {
  private static async delay(ms: number) {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve()
    }
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Выполнить запрос с повторными попытками.
   *
   * @param callback - функция, выполняющая запрос к AmoCRM API
   * @returns результат выполнения callback
   * @throws ApiAuthError - при ошибке авторизации (401)
   * @throws ApiLimitError - при превышении лимита (429)
   * @throws ApiRetryExhaustedError - при исчерпании попыток
   * @throws ApiFatalError - при других неисправимых ошибках
   */
  public static async call<T>(callback: () => Promise<T>): Promise<T> {
    let attempt = 0
    const maxAttempts = amocrmRetryConfig.retryDelaysMs.length

    while (true) {
      try {
        const result = await callback()
        return result
      } catch (error: unknown) {
        const err = error as {
          response?: {
            status?: number
            data?: unknown
          }
          message?: string
          name?: string
          code?: string
        }

        const status = err.response?.status

        if (status === 401) {
          throw new ApiAuthError(
            `AmoCRM API 401: Токен истёк или недействителен. Требуется обновление.`
          )
        }

        if (status === 429) {
          if (attempt < maxAttempts) {
            const waitMs =
              amocrmRetryConfig.retryDelaysMs[attempt] || amocrmRetryConfig.universalDelayMs
            await this.delay(waitMs)
            attempt++
            continue
          } else {
            throw new ApiLimitError(
              `AmoCRM API 429: Превышен лимит запросов после ${maxAttempts} попыток`
            )
          }
        }

        if (status === 400) {
          const message = err.message || 'Неверный запрос к AmoCRM API'
          throw new ApiFatalError(message, status)
        }

        if (status === 403) {
          throw new ApiAuthError(`AmoCRM API 403: Доступ запрещён`)
        }

        const retryableStatuses = [500, 502, 503, 504]
        const isNetworkError =
          !status &&
          (err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'EPIPE' ||
            err.code === 'EAI_AGAIN' ||
            err.message?.toLowerCase().includes('socket hang up'))

        if ((status && retryableStatuses.includes(status)) || isNetworkError) {
          if (attempt < maxAttempts) {
            const waitMs =
              amocrmRetryConfig.retryDelaysMs[attempt] || amocrmRetryConfig.universalDelayMs
            console.log(
              `[AmocrmRetry] Попытка ${attempt + 1} из-за ${status || (isNetworkError ? 'NetworkError (' + err.code + ')' : 'unknown')}. Ожидание ${waitMs}мс...`
            )
            await this.delay(waitMs)
            attempt++
            continue
          } else {
            const errorLabel = isNetworkError
              ? `Разрыв сетевого соединения (${err.code})`
              : `AmoCRM API недоступен (${status})`
            throw new ApiRetryExhaustedError(`${errorLabel} после ${maxAttempts} попыток`)
          }
        }
        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiRetryExhaustedError ||
          error instanceof ApiFatalError
        ) {
          throw error
        }
        throw new ApiFatalError(err.message || 'Неизвестная ошибка при обращении к AmoCRM API')
      }
    }
  }
}
