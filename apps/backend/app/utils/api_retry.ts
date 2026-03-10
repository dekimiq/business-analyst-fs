import { isAxiosError } from 'axios'
import type { IRetryConfig } from '@project/shared'

/**
 * Exception thrown when an API authentication error occurs (401 or 403).
 */
export class ApiAuthError extends Error {
  constructor(message: string = 'API Authentication Error') {
    super(message)
    this.name = 'ApiAuthError'
  }
}

/**
 * Exception thrown when the number of retry attempts has been exhausted.
 */
export class ApiRetryExhaustedError extends Error {
  constructor(message: string = 'API Retry Limit Exhausted') {
    super(message)
    this.name = 'ApiRetryExhaustedError'
  }
}

/**
 * Exception thrown when a fatal API error occurs (e.g., specified fatal HTTP status codes).
 */
export class ApiFatalError extends Error {
  public status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiFatalError'
    this.status = status
  }
}

export class ApiRetryService {
  private static async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Universal retry method for API calls.
   *
   * @param config - The retry configuration.
   * @param callback - The asynchronous operation (e.g., an Axios request) to be retried.
   */
  public static async call<T>(config: IRetryConfig, callback: () => Promise<T>): Promise<T> {
    let attempt = 0

    while (true) {
      try {
        const result = (await callback()) as any
        const status = result?.status
        if ((status === 201 || status === 202) && config.reportDelaysMs) {
          if (attempt < config.reportDelaysMs.length) {
            await this.delay(config.reportDelaysMs[attempt])
            attempt++
            continue
          } else {
            throw new ApiRetryExhaustedError('Report generation taking too long.')
          }
        }

        if (config.extractErrorCode) {
          const errorCode = config.extractErrorCode(result?.data || result)
          if (errorCode !== null && errorCode !== undefined) {
            if (config.limitApiErrorCodes.includes(errorCode)) {
              if (attempt < config.retryDelaysMs.length) {
                const waitMs = config.universalDelayMs || config.retryDelaysMs[attempt]
                await this.delay(waitMs)
                attempt++
                continue
              } else {
                throw new ApiRetryExhaustedError('API call rate limited and retries exhausted.')
              }
            }
          }
        }

        return result
      } catch (error: any) {
        if (isAxiosError(error)) {
          const status = error.response?.status

          if (status === 401 || status === 403) {
            throw new ApiAuthError(error.message)
          }

          if (status && config.fatalHttpStatuses.includes(status)) {
            throw new ApiFatalError(error.message, status)
          }

          if (status && config.retryableHttpStatuses.includes(status)) {
            if (attempt < config.retryDelaysMs.length) {
              await this.delay(config.retryDelaysMs[attempt])
              attempt++
              continue
            } else {
              throw new ApiRetryExhaustedError(error.message)
            }
          }

          if (!status || (status >= 500 && status <= 599)) {
            if (attempt < config.retryDelaysMs.length) {
              await this.delay(config.retryDelaysMs[attempt])
              attempt++
              continue
            }
          }
          throw new ApiFatalError(error.message, status)
        }

        throw error
      }
    }
  }
}
