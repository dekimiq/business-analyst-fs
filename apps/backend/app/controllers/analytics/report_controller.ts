import { type HttpContext } from '@adonisjs/core/http'
import { ApiResponse } from '#utils/api_response'
import { WeeklyReportService } from '#services/analytics/weekly_report_service'
import { getLastWeekBoundaries } from '#utils/date_utils'
import env from '#start/env'

export default class ReportController {
  /**
   * Аналитический метод для ИИ-агента.
   * Отдает отчет по окупаемости (ROMI) за прошлую неделю.
   */
  public async getWeeklyRomi({ response }: HttpContext) {
    const tz = env.get('BUSINESS_TZ')
    const { start, end } = getLastWeekBoundaries(tz)

    try {
      const reportService = new WeeklyReportService()
      const data = await reportService.getRomiReport(start, end)

      return response.ok({
        ...ApiResponse.ok('Отчет по окупаемости РК за прошедшую неделю сформирован', data),
        meta: {
          period: data.period, // Пример: "09.03.25-15.03.25"
          actually_applied_range: {
            start: start.toISO(),
            end: end.toISO(),
            tz: tz,
          },
        },
      })
    } catch (e: any) {
      if (e.message === 'Нет маркетинговых данных за этот период') {
        return response.ok({
          ...ApiResponse.error(e.message, null),
          meta: {
            actually_applied_range: {
              start: start.toISO(),
              end: end.toISO(),
              tz: tz,
            },
          },
        })
      }

      return response.internalServerError(
        ApiResponse.error('Произошла ошибка при формировании аналитического отчета', e.message)
      )
    }
  }
}
