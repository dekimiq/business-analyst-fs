import db from '@adonisjs/lucid/services/db'
import CrmPipeline from '#models/crm_pipeline'
import CrmStatus from '#models/crm_status'
import type { AmocrmSyncContext } from './amocrm_sync_context.js'

/**
 * Синхронизирует воронки (Pipelines) и их этапы (Statuses) из AmoCRM.
 */
export async function syncPipelinesAndStatuses(ctx: AmocrmSyncContext): Promise<void> {
  const { api, logger, source } = ctx

  try {
    const pipelines = await api.getPipelines()
    logger.info(`[AmoCRM] Получено воронок: ${pipelines.length} шт.`)

    await db.transaction(async (trx) => {
      for (const p of pipelines) {
        await CrmPipeline.updateOrCreate(
          { id: String(p.id) },
          {
            name: p.name,
            sort: p.sort ?? 0,
            isMain: p.is_main ?? false,
            source,
          },
          { client: trx }
        )

        const statuses = p._embedded?.statuses || []
        for (const s of statuses) {
          await CrmStatus.updateOrCreate(
            { id: String(s.id) },
            {
              pipelineId: String(s.pipeline_id),
              name: s.name,
              color: s.color,
              sort: s.sort ?? 0,
              type: String(s.type),
              source,
            },
            { client: trx }
          )
        }
      }
    })

    logger.info(`[AmoCRM] Структурная синхронизация (Pipelines/Statuses) завершена успешно.`)
  } catch (error: any) {
    logger.error(`[AmoCRM] Ошибка при структурной синхронизации: ${error.message}`)
    throw error
  }
}
