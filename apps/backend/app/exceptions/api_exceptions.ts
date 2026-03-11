/**
 * Базовые классы ошибок для работы с внешними API и процессами синхронизации.
 */

/**
 * Ошибка авторизации в API (401 или 403).
 */
export class ApiAuthError extends Error {
  constructor(message: string = 'Ошибка авторизации API') {
    super(message)
    this.name = 'ApiAuthError'
  }
}

/**
 * Ошибка, выбрасываемая когда лимит попыток повтора (retry) исчерпан.
 */
export class ApiRetryExhaustedError extends Error {
  constructor(message: string = 'Количество попыток обращений к API достигло лимита') {
    super(message)
    this.name = 'ApiRetryExhaustedError'
  }
}

/**
 * Фатальная ошибка API, при которой продолжение процесса невозможно.
 */
export class ApiFatalError extends Error {
  public status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiFatalError'
    this.status = status
  }
}
