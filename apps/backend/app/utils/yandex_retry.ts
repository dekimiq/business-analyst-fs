import { isAxiosError } from 'axios'
import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiReportUnpossible,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'
import { yandexRetryConfig } from '#app_config/api/yandex_retry_config'

// Error_code яндекса
const errorCodesAuth = [53, 513, 300, 3001, 54]
const errorCodesRetryable = [152, 52]
const errorCodesLimit = [506]

// Http статусы
const statusesReportWaiting = [201, 202]

export class YandexRetryService {
  private static async delay(ms: number) {
    if (process.env.NODE_ENV === 'test' && !process.env.FORCE_DELAY) {
      return Promise.resolve()
    }
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Специализированный метод повтора для API Яндекса.
   * Обрабатывает специфические коды ошибок в теле ответа и HTTP статусы.
   */
  public static async call<T>(callback: () => Promise<T>): Promise<T> {
    let attempt = 0
    const maxAttempts = 5

    while (true) {
      try {
        const response = (await callback()) as any
        const status = response?.status
        const data = response?.data

        if (statusesReportWaiting.includes(status)) {
          if (attempt < maxAttempts) {
            const waitMs = yandexRetryConfig.reportDelaysMs![attempt] || 30000
            await this.delay(waitMs)
            attempt++
            continue
          } else {
            throw new ApiRetryExhaustedError('Отчет не был сформирован после 5 попыток')
          }
        }

        // 2. Обработка ошибок в теле ответа (200 OK с ошибкой в JSON)
        if (data && typeof data === 'object') {
          const errorCode = data.error?.error_code || data.error_code

          if (errorCode) {
            // Ошибки авторизации
            if (errorCodesAuth.includes(errorCode)) {
              const errorStr = data.error?.error_string || ''
              throw new ApiAuthError(`Yandex Auth Error (${errorCode}): ${errorStr}`)
            }

            // Retryable codes (152, 52)
            if (errorCodesRetryable.includes(errorCode)) {
              if (attempt < maxAttempts) {
                const waitMs = yandexRetryConfig.retryDelaysMs[attempt] || 60000
                console.log(
                  `[YandexRetry] Error ${errorCode}. Waiting ${waitMs}ms before retry (attempt ${attempt + 1})...`
                )
                await this.delay(waitMs)
                attempt++
                continue
              } else {
                if (errorCode === 152) {
                  throw new ApiLimitError(`Yandex Limit Error (152) после ${maxAttempts} попыток`)
                }
                throw new ApiRetryExhaustedError(`Исчерпаны попытки для кода ${errorCode}`)
              }
            }

            // Лимиты
            if (errorCodesLimit.includes(errorCode)) {
              throw new ApiLimitError(`Yandex Limit Error (${errorCode})`)
            }
          }
        }

        return response
      } catch (error: any) {
        if (isAxiosError(error)) {
          const status = error.response?.status
          const data = error.response?.data
          const errorCode = data?.error?.error_code || data?.error_code

          // Обработка 401
          if (status === 401) {
            throw new ApiAuthError('Yandex API 401: Не авторизован')
          }

          // Обработка 400 с кодом 8312 (Невозможно построить отчет)
          if (status === 400 && errorCode === 8312) {
            throw new ApiReportUnpossible('Яндекс не может построить отчет сейчас (код 8312)')
          }

          if (errorCodesRetryable.includes(errorCode)) {
            if (attempt < maxAttempts) {
              const waitMs = yandexRetryConfig.retryDelaysMs[attempt] || 60000
              await this.delay(waitMs)
              attempt++
              continue
            } else {
              if (errorCode === 152) {
                throw new ApiLimitError(`Yandex Limit Error (152) после ${maxAttempts} попыток`)
              }
              throw new ApiRetryExhaustedError(`Исчерпаны попытки для кода ${errorCode}`)
            }
          }

          // Лимиты в 4xx
          if (errorCodesLimit.includes(errorCode)) {
            throw new ApiLimitError(`Yandex Limit Error (${errorCode})`)
          }

          // Повторяемые HTTP ошибки (5xx, 429)
          const retryableStatuses = [429, 500, 502, 503, 504]
          if (status && retryableStatuses.includes(status)) {
            if (attempt < maxAttempts) {
              const waitMs = yandexRetryConfig.retryDelaysMs[attempt] || 60000
              await this.delay(waitMs)
              attempt++
              continue
            } else {
              throw new ApiRetryExhaustedError(`API Yandex временно недоступен (${status})`)
            }
          }

          // Все остальные 4xx/5xx - фатальные
          throw new ApiFatalError(error.message, status)
        }

        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiReportUnpossible ||
          error instanceof ApiRetryExhaustedError
        ) {
          throw error
        }

        throw new ApiFatalError(error.message || 'Неизвестная ошибка при обращении к Yandex API')
      }
    }
  }
}
