import SyncLog from '#models/sync_log'
import { NotificationService } from '#services/notification_service'

export class SyncLoggerService {
  constructor(private readonly source: string) {}

  private async log(level: 'info' | 'warn' | 'error', message: string, metadata?: any) {
    const prefix = `[${level.toUpperCase()}] - [${this.source}]:`

    if (level === 'error') {
      console.error(prefix, message, metadata || '')

      try {
        await NotificationService.getInstance().notifyError(this.source, message)
      } catch (err) {
        console.error('Failed to send error notification:', err)
      }
    } else if (level === 'warn') {
      console.warn(prefix, message, metadata || '')
    } else {
      console.log(prefix, message, metadata || '')
    }

    SyncLog.create({
      source: this.source,
      level,
      message,
      metadata: metadata ? JSON.stringify(metadata) : null,
    }).catch((err) => console.error('Error saving sync log:', err))
  }

  async info(message: string, metadata?: any) {
    return this.log('info', message, metadata)
  }

  async warn(message: string, metadata?: any) {
    return this.log('warn', message, metadata)
  }

  async error(message: string, metadata?: any) {
    return this.log('error', message, metadata)
  }
}
