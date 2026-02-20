import axios from 'axios'

const RETRY_DELAYS = [360, 540, 720, 900, 1080]
const REPORT_DELAYS = [30, 60, 120, 180, 300]
const UNIVERSAL_DELAY = 100

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

export class YandexUnknownError extends Error {}
export class YandexRetryExhaustedError extends Error {}

export async function withYandexRetry<T>(
  fn: () => Promise<{ status: number; data: T }>
): Promise<T> {
  let attempt = 0
  type LIMIT = 'LIMIT'
  type ERROR = 'ERROR'
  let typeError: null | LIMIT | ERROR = null
  while (attempt < RETRY_DELAYS.length) {
    try {
      const response = await fn()

      if (response.status === 200) {
        return response.data
      }

      if (response.status === 202) {
        const delay = REPORT_DELAYS[attempt] ?? 300
        console.log(`[Yandex] Отчет готовится (202), жду ${delay} сек...`)
        typeError = null
        await sleep(delay)
        attempt++
        continue
      }

      if (response.status === 201) {
        const delay = RETRY_DELAYS[attempt] ?? 300
        console.log(`[Yandex] Отчет поставлен в очередь (201), жду ${delay} сек...`)
        typeError = null
        await sleep(delay)
        attempt++
        continue
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        const data = error.response?.data

        if (status === 400) {
          console.error('[Yandex] Ошибка 400, проверьте параметры запроса:', data)
          throw new YandexUnknownError('[Yandex] Попытка запроса. Неверный запрос.')
        }

        if (status === 401 || status === 403) {
          console.error('[Yandex] Ошибка авторизации:', data)
          throw new YandexUnknownError('[Yandex] Попытка запроса. Статус не авторизован.')
        }

        if (status === 429) {
          const delay = RETRY_DELAYS[attempt]
          console.warn(`[Yandex] Лимит запросов (${status}), жду ${delay} сек...`)
          typeError = 'LIMIT'
          await sleep(delay)
          attempt++
          continue
        }

        if (status === 152 || status === 506) {
          const delay = RETRY_DELAYS[attempt]
          console.warn(`[Yandex] Лимит запросов (${status}), жду ${delay} сек...`)
          typeError = 'LIMIT'
          await sleep(delay)
          attempt++
          continue
        }

        const delay = UNIVERSAL_DELAY
        console.error(`[Yandex] Неожиданный статус: ${status}, жду ${delay} сек...`)
        typeError = 'ERROR'
        await sleep(delay)
        attempt++
        continue
      }
    }
  }

  if (typeError === 'LIMIT' || typeError === null) {
    throw new YandexRetryExhaustedError(
      '[Yandex] Все 5 попыток исчерпаны. Лимиты Яндекса исчерпаны на сегодня.'
    )
  }

  throw new YandexUnknownError(
    '[Yandex] Все 5 попыток исчерпаны. Ошибки сети или неизвестный статус ответа.'
  )
}
