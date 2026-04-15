import { Job } from 'adonisjs-jobs'
import CrmRecord from '#models/crm_record'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

export interface EnrichmentJobPayload {
  batchSize?: number
}

/**
 * Оптимизированный Worker для массового обогащения сделок AmoCRM данными из Yandex.
 * Избегает N+1 запросов за счет использования Bulk Match (Map в памяти).
 */
export default class LeadEnrichmentJob extends Job {
  async handle(payload: EnrichmentJobPayload) {
    const batchSize = payload.batchSize || 1000
    logger.info(`[Enrichment] Запуск оптимизированного пайплайна...`)

    // 1. Извлекаем пачку записей для обработки
    const recordsToProcess = await CrmRecord.query()
      .andWhere((query) => {
        query.whereNull('campaignPk').orWhereNull('groupPk').orWhereNull('adPk')
      })
      .andWhere('matchRetryCount', '<', 150)
      .andWhere((query) => {
        query
          .whereNull('nextMatchRetryAt')
          .orWhere('nextMatchRetryAt', '<=', DateTime.now().toSQL()!)
      })
      .limit(batchSize)

    logger.info(`[Enrichment] Найдено для обработки: ${recordsToProcess.length}.`)

    if (recordsToProcess.length === 0) {
      return
    }

    // 2. Предварительный сбор всех потенциальных ID
    const allCandidateIds = new Set<string>()
    for (const record of recordsToProcess) {
      const candidates = this.extractPossibleIds(record.rawIds)
      if (record.adId) candidates.push(record.adId)
      candidates.forEach((id) => allCandidateIds.add(String(id)))
    }

    if (allCandidateIds.size === 0) {
      for (const record of recordsToProcess) {
        await this.handleUnmatched(record)
      }
      return
    }

    // 3. Массовый поиск в БД Яндекса
    const candidateArray = Array.from(allCandidateIds)
    const adsData = await db
      .from('backend.ads as ads')
      .join('backend.ad_groups as grp', 'ads.group_pk', 'grp.id')
      .join('backend.campaigns as cmp', 'grp.campaign_pk', 'cmp.id')
      .select({
        ad_pk: 'ads.id',
        ad_id: 'ads.ad_id',
        group_pk: 'grp.id',
        group_id: 'grp.group_id',
        campaign_pk: 'cmp.id',
        campaign_id: 'cmp.campaign_id',
      })
      .whereIn('ads.ad_id', candidateArray)
      .where('ads.source', 'yandex')

    const adsMap = new Map<string, any>()
    adsData.forEach((ad) => adsMap.set(String(ad.ad_id), ad))

    // 4. Маппинг и сохранение
    let matchedCount = 0
    for (const record of recordsToProcess) {
      const candidates = this.extractPossibleIds(record.rawIds)
      if (record.adId && !candidates.includes(record.adId)) {
        candidates.unshift(record.adId)
      }

      let matched = false
      for (const cand of candidates) {
        const found = adsMap.get(String(cand))
        if (found) {
          record.adPk = found.ad_pk
          record.groupPk = found.group_pk
          record.campaignPk = found.campaign_pk

          record.adId = found.ad_id
          record.groupId = found.group_id
          record.campaignId = found.campaign_id

          await record.save()
          matched = true
          matchedCount++
          break
        }
      }

      if (!matched) {
        await this.handleUnmatched(record)
      }
    }

    logger.info(`[Enrichment] Обработка завершена. Сматчено: ${matchedCount}.`)
  }

  private async handleUnmatched(record: CrmRecord) {
    record.matchRetryCount += 1
    record.nextMatchRetryAt = DateTime.now().plus({ hours: 12 })
    await record.save()
  }

  private extractPossibleIds(rawIdsStr: string | null): string[] {
    if (!rawIdsStr) return []

    if (rawIdsStr.startsWith('[') || rawIdsStr.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawIdsStr)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch {
        return []
      }
    }

    return rawIdsStr
      .split('|')
      .map((id) => id.trim())
      .filter((id) => id.length > 0) // Убрали `/^\d+$/` для поддержки тестовых ID
  }
}
