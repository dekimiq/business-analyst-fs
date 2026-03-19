export interface NotificationJobData {
  message: string
  recipientIds?: string[]
}

export interface NotificationJobResult {
  sentCount: number
  failedCount: number
}
