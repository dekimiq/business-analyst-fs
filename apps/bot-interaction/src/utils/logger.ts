import { env } from '@project/env'

type LogLevel = 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
}

const currentLevelStr = env.LOG_LEVEL as string
const currentLevel: LogLevel = currentLevelStr in LEVELS ? (currentLevelStr as LogLevel) : 'info'

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString()
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`
  if (meta !== undefined) {
    return `${base} ${JSON.stringify(meta)}`
  }
  return base
}

export const logger = {
  info(message: string, meta?: unknown): void {
    if (shouldLog('info')) console.info(format('info', message, meta))
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(format('warn', message, meta))
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(format('error', message, meta))
  },
}

// Срок хранения логов — 3 месяца
const LOG_RETENTION_MONTHS = 3

/**
 * Удаляет записи логов уведомлений старше 3 месяцев.
 * Вызывать при старте и затем по расписанию (например, раз в сутки).
 */
export async function cleanupOldLogs(db: import('knex').Knex): Promise<void> {
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - LOG_RETENTION_MONTHS)

  try {
    const deleted = await db('bot.notification_log').where('sent_at', '<', cutoffDate).delete()

    if (deleted > 0) {
      logger.info(
        `Автоочистка логов: удалено ${deleted} записей старше ${LOG_RETENTION_MONTHS} мес.`,
      )
    }
  } catch (err) {
    logger.error('Ошибка при очистке старых логов', { err })
  }
}
