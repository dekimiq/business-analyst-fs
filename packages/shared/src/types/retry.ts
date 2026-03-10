import type { AxiosError } from 'axios'

export interface IRetryConfig {
  retryDelaysMs: readonly number[]
  reportDelaysMs?: readonly number[]
  universalDelayMs: number
  retryableHttpStatuses: readonly number[]
  fatalHttpStatuses: readonly number[]
  limitApiErrorCodes: readonly number[]

  extractErrorCode?: (data: any) => number | null | undefined
}
