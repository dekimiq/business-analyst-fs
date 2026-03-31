import { isAxiosError } from 'axios'
import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiReportUnpossible,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'

const RETRY_DELAY_MS = 10000
const MAX_ATTEMPTS = process.env.NODE_ENV === 'test' ? 1 : 3

const YANDEX_ERROR_MAP: Record<number, 'auth' | 'limit' | 'retry' | 'unpossible'> = {
  // Авторизация
  53: 'auth',
  513: 'auth',
  300: 'auth',
  3001: 'auth',
  54: 'auth',

  // Лимиты (срабатывают, если аккаунт перегружен запросами)
  152: 'limit',
  506: 'limit',

  // Мелкие перебои на стороне Яндекса, требующие короткую паузу
  52: 'retry',

  // Невозможно построить отчет на стороне Яндекса
  8312: 'unpossible',
}

const HTTP_STATUS_MAP: Record<number, 'auth' | 'retry' | 'queued'> = {
  201: 'queued',
  202: 'queued',
  401: 'auth',
  429: 'retry',
  500: 'retry',
  502: 'retry',
  503: 'retry',
  504: 'retry',
}

export class YandexRetryService {
  private static async delay(ms: number) {
    if (process.env.NODE_ENV === 'test' && !process.env.FORCE_DELAY) return
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Чистый и плоский метод повтора для API Яндекса.
   * Управляется через маппинги YANDEX_ERROR_MAP и HTTP_STATUS_MAP.
   */
  public static async call<T>(callback: () => Promise<T>): Promise<T> {
    let attempt = 1

    while (attempt <= MAX_ATTEMPTS) {
      try {
        const response = (await callback()) as any

        // Если callback вернул уже очищенные данные (строку/массив), а не AxiosResponse
        if (typeof response !== 'object' || response === null || !('status' in response)) {
          return response
        }

        const status = response.status
        let data = response.data

        // Если data - строка (например, из Reports API), попробуем распарсить её как JSON для поиска ошибки
        if (typeof data === 'string' && data.trim().startsWith('{')) {
          try {
            data = JSON.parse(data)
          } catch {
            // Игнорируем ошибки парсинга, это может быть реальный TSV
          }
        }

        if (status === 201 || status === 202) {
          throw new ApiRetryExhaustedError(
            `Отчет генерируется (HTTP ${status}). Возврат для асинхронной очереди.`
          )
        }

        if (data && typeof data === 'object' && (data.error?.error_code || data.error_code)) {
          const errorCode = data.error?.error_code || data.error_code
          const errorStr = data.error?.error_string || ''

          this.handleMappedError(errorCode, errorStr, attempt)
        }

        return response
      } catch (error: any) {
        // Успешный проброс Queue-ошибок (мы их кидали сами выше в Try блоке)
        if (error instanceof ApiRetryExhaustedError && error.message.includes('генерируется')) {
          throw error
        }

        // 3. Разбираем Axios Error (когда HTTP статус != 2xx)
        if (isAxiosError(error) && error.response) {
          const status = error.response.status
          let data = error.response.data

          // Попытка парсинга строки ошибки
          if (typeof data === 'string' && data.trim().startsWith('{')) {
            try {
              data = JSON.parse(data)
            } catch {
              /* ignore */
            }
          }

          const errorCode = data?.error?.error_code || data?.error_code
          const errorStr = data?.error?.error_string || error.message

          // Если HTTP статус есть в маппинге:
          if (HTTP_STATUS_MAP[status]) {
            const action = HTTP_STATUS_MAP[status]
            if (action === 'auth') throw new ApiAuthError(`Yandex API 401: Не авторизован`)
            if (action === 'queued')
              throw new ApiRetryExhaustedError(`Отчет генерируется (HTTP ${status})`)
            if (action === 'retry') {
              // fallthrough, ничего не делаем, проваливаемся вниз до блока "Ретрай"
            }
          } else if (!errorCode) {
            // Если статус неизвестен (например 404, 403) и Яндекс НЕ прислал `error_code`, это фундаментально фатальная ошибка
            throw new ApiFatalError(`HTTP Фатальная ошибка ${status}: ${errorStr}`)
          }

          // Если Яндекс прислал body.error_code вместе с ошибкой сети 400/500
          if (errorCode) {
            this.handleMappedError(errorCode, errorStr, attempt)
          }
        }

        // 4. Если ошибка уже классифицирована как строгая (auth, limit, fatal) — пробрасываем выше, прекращая цикл сразу!
        if (
          error instanceof ApiAuthError ||
          error instanceof ApiLimitError ||
          error instanceof ApiReportUnpossible ||
          error instanceof ApiFatalError
        ) {
          throw error
        }

        const isNetworkError =
          (error.code === 'ECONNRESET' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'EPIPE' ||
            error.code === 'EAI_AGAIN' ||
            error.message?.toLowerCase().includes('socket hang up')) &&
          !error.response

        // 5. Ретрай (Повторимые ошибки или нестандартные таймауты сети)
        if (attempt < MAX_ATTEMPTS) {
          const errorLabel = isNetworkError
            ? `NetworkError (${error.code || 'socket hang up'})`
            : error.message || 'Unknown error'
          console.log(
            `[YandexRetry] Попытка ${attempt} провалилась: ${errorLabel}. Универсальное ожидание ${RETRY_DELAY_MS}мс...`
          )
          await this.delay(RETRY_DELAY_MS)
          attempt++
          continue
        } else {
          if (error instanceof ApiRetryExhaustedError) throw error // Уже отформатированная
          throw new ApiRetryExhaustedError(
            error.message || 'Исчерпаны попытки Yandex API после лимита таймаутов сети'
          )
        }
      }
    }

    throw new ApiFatalError('Недостижимый код YandexRetryService')
  }

  /**
   * Конвертирует Yandex Error Code в нужный Exception или генерирует триггер ретрая
   */
  private static handleMappedError(errorCode: number, errorStr: string, attempt: number) {
    const action = YANDEX_ERROR_MAP[errorCode]

    if (action === 'auth') throw new ApiAuthError(`Yandex Auth Error (${errorCode}): ${errorStr}`)
    if (action === 'limit')
      throw new ApiLimitError(`Yandex Limit Error (${errorCode}): ${errorStr}`)
    if (action === 'unpossible')
      throw new ApiReportUnpossible(
        `Яндекс не может построить отчет (код ${errorCode}): ${errorStr}`
      )

    if (action === 'retry') {
      if (attempt >= MAX_ATTEMPTS) {
        throw new ApiRetryExhaustedError(`Исчерпаны 3 попытки для Yandex кода ${errorCode}`)
      }
      // Выбрасываем обычный Error, чтобы catch-блок принял его на вход и активировал ветку Ретрая через delay
      throw new Error(`Yandex Retryable Error ${errorCode} - ${errorStr}`)
    }

    // Если код пришел от Яндекса, но он отсутствует в нашем маппинге - гарантированный Fatal
    throw new ApiFatalError(`Неизвестный код ошибки Yandex API: ${errorCode} - ${errorStr}`)
  }
}
