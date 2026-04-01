import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import CrmStatus from '#models/crm_status'

export interface RomiReportData {
  period: string
  spend: number
  impressions: number
  clicks: number
  leadsCount: number
  paymentsCount: number
  salesSum: number
  cpl: number
  cac: number
  romi: number
}

export class WeeklyReportService {
  /**
   * Расчет ROMI отчета за период
   */
  public async getRomiReport(start: DateTime, end: DateTime): Promise<RomiReportData> {
    const periodStr = `${start.toFormat('dd.MM.yy')}-${end.toFormat('dd.MM.yy')}`

    // 1. Считаем расход из daily_stats
    // Так как daily_stats.date - это DATE, мы можем сравнивать его напрямую
    const statsResult = await db
      .from('backend.daily_stats as ds')
      .join('backend.ads as ads', 'ds.ad_pk', 'ads.id')
      .where('ads.source', 'yandex')
      .whereBetween('ds.date', [start.toFormat('yyyy-MM-dd'), end.toFormat('yyyy-MM-dd')])
      .select(
        db.raw('SUM(cost) as total_spend'),
        db.raw('SUM(clicks) as total_clicks'),
        db.raw('SUM(impressions) as total_impressions')
      )
      .first()

    const spend = Number(statsResult?.total_spend || 0)
    const clicks = Number(statsResult?.total_clicks || 0)
    const impressions = Number(statsResult?.total_impressions || 0)

    // 2. Считаем лиды из crm_records
    // Учитываем record_created_at в UTC
    const leadsResult = await db
      .from('backend.crm_records')
      .where('source', 'yandex')
      .whereBetween('record_created_at', [start.toUTC().toISO()!, end.toUTC().toISO()!])
      .select(db.raw('COUNT(*) as total_leads'))
      .first()

    const leadsCount = Number(leadsResult?.total_leads || 0)

    // 3. Выявляем статусы "Оплачено"
    const paidStatuses = await CrmStatus.query().whereILike('name', '%оплач%').select('id')

    const paidStatusIds = paidStatuses.map((s) => s.id)

    // 4. Считаем оплаты и сумму продаж
    let paymentsCount = 0
    let salesSum = 0

    if (paidStatusIds.length > 0) {
      const salesResult = await db
        .from('backend.crm_records')
        .where('source', 'yandex')
        .whereIn('status_id', paidStatusIds)
        .whereBetween('record_created_at', [start.toUTC().toISO()!, end.toUTC().toISO()!])
        .select(db.raw('COUNT(*) as total_payments'), db.raw('SUM(price) as total_sales'))
        .first()

      paymentsCount = Number(salesResult?.total_payments || 0)
      salesSum = Number(salesResult?.total_sales || 0)
    }

    // 5. Проверка на наличие данных
    if (spend === 0 && leadsCount === 0) {
      throw new Error('Нет маркетинговых данных за этот период')
    }

    // 6. Расчеты
    const cpl = leadsCount > 0 ? spend / leadsCount : 0
    const cac = paymentsCount > 0 ? spend / paymentsCount : 0
    const romi = spend > 0 ? ((salesSum - spend) / spend) * 100 : 0

    return {
      period: periodStr,
      spend,
      impressions,
      clicks,
      leadsCount,
      paymentsCount,
      salesSum,
      cpl: Math.round(cpl),
      cac: Math.round(cac),
      romi: Math.round(romi),
    }
  }
}
