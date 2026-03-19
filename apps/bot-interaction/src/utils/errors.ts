// Базовые классы ошибок для бота

/**
 * Базовая ошибка бота
 */
export class BotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'BotError'
  }
}

/**
 * Ошибка очереди BullMQ
 */
export class QueueError extends BotError {
  constructor(message: string) {
    super(message, 'QUEUE_ERROR')
    this.name = 'QueueError'
  }
}

/**
 * Ошибка базы данных
 */
export class DatabaseError extends BotError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR')
    this.name = 'DatabaseError'
  }
}

/**
 * Ошибка отправки уведомления
 */
export class NotificationError extends BotError {
  constructor(message: string) {
    super(message, 'NOTIFICATION_ERROR')
    this.name = 'NotificationError'
  }
}
