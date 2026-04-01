import { Router, Request, Response } from 'express'
import { ReportService } from '../services/report.service.js'

const router = Router()

/**
 * Генерировать еженедельный аналитический отчет (Manual/Cron mode)
 */
router.post('/weekly', async (_req: Request, res: Response) => {
  try {
    const reportText = await ReportService.getInstance().generateWeeklyReport()
    res.json({ success: true, report: reportText })
  } catch (error: any) {
    console.error(`[AI Route] Ошибка в /weekly: ${error.message}`)
    res.status(500).json({ success: false, error: 'Не удалось сгенерировать отчет' })
  }
})

/**
 * Генерировать ежедневный отчет (заготовка на будущее)
 */
router.post('/daily', async (_req: Request, res: Response) => {
  res.status(501).json({ success: false, error: 'Ежедневные отчеты еще не реализованы' })
})

export default router
