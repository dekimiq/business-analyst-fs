import { AmocrmRetryService } from '#utils/amocrm_retry'
import type { AmocrmSyncContext } from './amocrm_sync_context.js'
import { saveLeadsToDb } from './save_leads.js'
import CrmRecord from '#models/crm_record'

/**
 * Инкрементальная синхронизация на основе Events API.
 */
export async function incrementalSync(ctx: AmocrmSyncContext): Promise<void> {
  const { meta, api, logger, source } = ctx
  const lastTs = Number(meta.lastTimestamp) || 0

  logger.info(`[AmoCRM] Запуск инкрементальной синхронизации (от ${lastTs})...`)

  let processedEventsCount = 0

  await api.eachEvent(lastTs, async (events) => {
    const leadIdsToFetch = new Set<number>()
    const leadIdsToDelete = new Set<number>()
    let currentBatchMaxTs = lastTs

    for (const event of events) {
      if (event.entity_type === 'lead') {
        if (event.type === 'lead_deleted') {
          leadIdsToDelete.add(event.entity_id)
          leadIdsToFetch.delete(event.entity_id)
        } else if (event.type === 'lead_restored') {
          leadIdsToFetch.add(event.entity_id)
          leadIdsToDelete.delete(event.entity_id)
        } else {
          leadIdsToFetch.add(event.entity_id)
        }
      }
      if (event.created_at > currentBatchMaxTs) {
        currentBatchMaxTs = event.created_at
      }
    }

    // A. Обработка удалений (Базовая - помечаем как удалено, если есть в БД)
    if (leadIdsToDelete.size > 0) {
      const idsToDelete = Array.from(leadIdsToDelete).map(String)
      const rowsAffected = await CrmRecord.query()
        .where('source', source)
        .whereIn('deal_id', idsToDelete) // В БД поле deal_id
        .update({ is_deleted: true })

      logger.info(
        `[AmoCRM] События удаления для ${idsToDelete.length} сделок. Затронуто БД: ${rowsAffected}`
      )
    }

    // B. Загрузка измененных/новых сделок
    if (leadIdsToFetch.size > 0) {
      const leads = await AmocrmRetryService.call(() =>
        api.getLeadsByIds(Array.from(leadIdsToFetch))
      )
      if (leads.length > 0) {
        await saveLeadsToDb(ctx, leads)
      }
    }

    // C. Чекпоинт: Обновляем курсор СРАЗУ, чтобы при падении не перекачивать те же события
    meta.lastTimestamp = String(currentBatchMaxTs)
    await meta.save()

    processedEventsCount += events.length
    logger.info(
      `[AmoCRM] Успешно обработано ${processedEventsCount} событий. Текущий крусор: ${currentBatchMaxTs}`
    )
  })

  logger.info(`[AmoCRM] Инкрементальная синхронизация завершена успешно.`)
}
