/**
 * Ошибки, связанные с логикой синхронизации и метаданными.
 */

/**
 * Базовый класс для ошибок синхронизации.
 */
export class SyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

/**
 * Ошибка: отсутствует OAuth токен для интеграции.
 */
export class MetaTokenUnavailableError extends SyncError {
  constructor() {
    super('token_unavailable')
    this.name = 'MetaTokenUnavailableError'
  }
}

/**
 * Ошибка: не установлена дата начала синхронизации.
 */
export class MetaSyncStartDateUnavailableError extends SyncError {
  constructor() {
    super('sync_start_date_unavailable')
    this.name = 'MetaSyncStartDateUnavailableError'
  }
}
