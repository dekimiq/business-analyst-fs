import type { IRetryConfig } from '#types/retry'

/**
 * Конфигурация повторных попыток для AmoCRM API.
 *
 * Особенности AmoCRM API:
 * - Rate limit: 7 запросов в секунду для бесплатного плана, больше для платных
 * - Код 429: Too Many Requests
 * - Код 401: Unauthorized (токен истёк)
 * - Код 400: Bad Request (ошибка в параметрах)
 */
export const amocrmRetryConfig: IRetryConfig = {
  retryDelaysMs: [1000, 2000, 4000, 8000, 16000],
  universalDelayMs: 5000,

  extractErrorCode: (_data: unknown) => null,
}
