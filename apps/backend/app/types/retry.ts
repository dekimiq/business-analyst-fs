export interface IRetryConfig {
  retryDelaysMs: readonly number[]
  reportDelaysMs?: readonly number[]
  universalDelayMs: number

  extractErrorCode?: (data: any) => number | null | undefined
}
