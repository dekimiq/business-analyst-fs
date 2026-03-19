export interface NotificationJobData {
  message?: string
  type?: 'error' | 'success' | 'info'
  payload?: {
    service: string
    module: string
    message: string
    [key: string]: any
  }
  recipientIds?: string[]
}

export interface NotificationJobResult {
  sentCount: number
  failedCount: number
}
