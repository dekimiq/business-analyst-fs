/**
 * Утилитный класс для унификации JSON-ответов API.
 * Формат: { status, message, data }
 */
export class ApiResponse {
  /**
   * Успешный ответ (ok)
   */
  public static ok(message: string, data: any = null) {
    return {
      status: 'ok',
      message,
      data,
    }
  }

  /**
   * Ответ с ошибкой (error)
   */
  public static error(message: string, data: any = null) {
    return {
      status: 'error',
      message,
      data,
    }
  }
}
