import type { IRetryConfig } from '@project/shared'

/**
 * Custom Yandex API Error Body structure, commonly returned alongside 200 HTTP status
 */
export interface YandexApiErrorBody {
  error_code: number
  error_string: string
  error_detail: string
  request_id: string
}

export const yandexRetryConfig: IRetryConfig = {
  retryDelaysMs: [360 * 1000, 540 * 1000, 720 * 1000, 900 * 1000, 1080 * 1000],
  reportDelaysMs: [30 * 1000, 60 * 1000, 120 * 1000, 180 * 1000, 300 * 1000],
  universalDelayMs: 60 * 1000,
  retryableHttpStatuses: [429, 503, 504, 506],
  fatalHttpStatuses: [400, 401, 403, 502, 500],
  limitApiErrorCodes: [152, 52],

  extractErrorCode: (data: any) => {
    if (data && typeof data === 'object' && 'error' in data) {
      const yandexError = data.error as YandexApiErrorBody
      return yandexError.error_code
    }
    return null
  },
}
