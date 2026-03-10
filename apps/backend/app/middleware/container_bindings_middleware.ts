import { Logger } from '@adonisjs/core/logger'
import { HttpContext } from '@adonisjs/core/http'
import { type NextFn } from '@adonisjs/core/types/http'

/**
 * Middleware привязок контейнера связывает классы с их значениями,
 * специфичными для запроса, используя резолвер контейнера.
 *
 * - Привязываем класс "HttpContext" к объекту "ctx"
 * - Привязываем класс "Logger" к "ctx.logger"
 */
export default class ContainerBindingsMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    ctx.containerResolver.bindValue(HttpContext, ctx)
    ctx.containerResolver.bindValue(Logger, ctx.logger)

    return next()
  }
}
