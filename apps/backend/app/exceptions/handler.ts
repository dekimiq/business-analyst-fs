import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { ApiResponse } from '#utils/api_response'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    /**
     * Обработка ошибок валидации VineJS
     */
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const firstError = error.messages[0]
      const message = `Ошибка в поле «${firstError.field}»: ${firstError.message}`

      return ctx.response.status(400).send(ApiResponse.error(message))
    }

    /**
     * Обработка NotFound для моделей и роутов
     */
    if ((error as any).code === 'E_ROW_NOT_FOUND' || (error as any).status === 404) {
      return ctx.response.status(404).send(ApiResponse.error('Ресурс не найден'))
    }

    /**
     * Все остальные ошибки
     */
    const status = (error as any).status || 500
    const message = this.debug
      ? (error as any).message || 'Внутренняя ошибка сервера'
      : (error as any).status === 500
        ? 'Произошла непредвиденная ошибка. Попробуйте позже.'
        : (error as any).message || 'Ошибка обработки запроса'

    return ctx.response.status(status).send(ApiResponse.error(message))
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
