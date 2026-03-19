import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import CrmRecord from '#models/crm_record'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import IntegrationMetadata, { ReferenceSyncPhase, SyncStatus } from '#models/integration_metadata'
import type { IAmocrmApiClient } from '#contracts/i_amocrm_api_client'
import type { AmoLead } from '#types/amocrm'
import {
  ApiAuthError,
  ApiFatalError,
  ApiLimitError,
  ApiRetryExhaustedError,
} from '#exceptions/api_exceptions'
import { MetaTokenUnavailableError, SyncError } from '#exceptions/sync_exceptions'
import { AmocrmRetryService } from '#utils/amocrm_retry'
import type { ISyncService } from '#contracts/i_sync_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

const SOURCE = 'amocrm'
const REFERENCE_CHECK_INTERVAL_MS = 10_000
const MAX_REFERENCE_CHECK_ATTEMPTS = 6

export class AmocrmSyncService implements ISyncService {
  public readonly source = SOURCE
  private readonly logger: SyncLoggerService

  constructor(private readonly api: IAmocrmApiClient) {
    this.logger = new SyncLoggerService(SOURCE)
  }

  // -------------------------------------------------------------------------
  // PUBLIC: ISyncService Implementation
  // -------------------------------------------------------------------------

  async sync(force: boolean = false): Promise<void> {
    const meta = await this.getMeta()

    if (!force && meta.syncStatus === SyncStatus.ERROR) {
      this.logger.warn(
        `Синхронизация AmoCRM пропущена: сервис находится в статусе ERROR. Ожидание вмешательства разработчика.`
      )
      return
    }

    if (force && meta.syncStatus === SyncStatus.ERROR) {
      this.logger.info(`Принудительный запуск синхронизации для '${SOURCE}' из состояния ERROR`)
    }

    this.logger.info(`Синхронизация AmoCRM запущена. Текущий статус: ${meta.syncStatus}`)

    try {
      if (!(meta.credentials as any)?.long_token) {
        throw new MetaTokenUnavailableError()
      }

      if (!meta.lastTimestamp || meta.syncStatus === null) {
        await this.initialSync(meta)
      } else {
        await this.incrementalSync(meta)
      }
    } catch (error) {
      await this.handleSyncError(meta, error)
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Core Sync Methods
  // -------------------------------------------------------------------------

  private async initialSync(meta: IntegrationMetadata): Promise<void> {
    await this.waitForReferenceData()

    this.logger.info('Начало первичной синхронизации (загрузка всех сделок)')

    meta.syncStatus = SyncStatus.PARTIAL
    meta.referenceSyncPhase = null
    meta.syncStartDate = null
    meta.syncedUntil = null
    await meta.save()

    let maxUpdatedAt = 0
    let pageCount = 0
    let page = await AmocrmRetryService.call(() => this.api.getLeads())

    while (true) {
      if (page.data.length > 0) {
        await this.saveLeadsToDb(page.data)
        const maxInPage = Math.max(...page.data.map((l) => l.updated_at))
        if (maxInPage > maxUpdatedAt) {
          maxUpdatedAt = maxInPage
        }
        pageCount++
        this.logger.info(`Первичная синхронизация: обработана страница ${pageCount}`)
      }

      if (!page.hasNext) break
      page = await AmocrmRetryService.call(() => page.next())
    }

    meta.lastTimestamp = String(maxUpdatedAt)
    meta.syncStatus = SyncStatus.SUCCESS
    meta.lastSuccessSyncDate = DateTime.utc()
    meta.lastError = null
    await meta.save()

    this.logger.info('Первичная синхронизация AmoCRM завершена успешно')
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Incremental sync
  // -------------------------------------------------------------------------

  private async incrementalSync(meta: IntegrationMetadata): Promise<void> {
    this.logger.info(`Инкрементальная синхронизация с курсора (updated_at): ${meta.lastTimestamp}`)

    meta.syncStatus = SyncStatus.PARTIAL
    await meta.save()

    const fromTimestamp = Number(meta.lastTimestamp) || 0
    let maxUpdatedAt = fromTimestamp
    let countNewLeads = 0

    let page = await AmocrmRetryService.call(() =>
      this.api.getLeads({
        updatedAt: { from: fromTimestamp },
      })
    )

    while (true) {
      if (page.data.length > 0) {
        await this.saveLeadsToDb(page.data)
        const maxInPage = Math.max(...page.data.map((l) => l.updated_at))
        if (maxInPage > maxUpdatedAt) {
          maxUpdatedAt = maxInPage
        }
        countNewLeads += page.data.length
      }

      if (!page.hasNext) break
      page = await AmocrmRetryService.call(() => page.next())
    }

    meta.lastTimestamp = String(maxUpdatedAt)
    meta.syncStatus = SyncStatus.SUCCESS
    meta.lastSuccessSyncDate = DateTime.utc()
    meta.lastError = null
    await meta.save()

    this.logger.info(
      `Инкрементальная синхронизация AmoCRM завершена. Загружено обновленных/новых сделок: ${countNewLeads}`
    )
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Reference Data - Ждём загрузки справочников от рекламных источников
  // -------------------------------------------------------------------------
  private async waitForReferenceData(): Promise<void> {
    this.logger.info('Ожидание загрузки справочных данных от рекламных источников...')

    for (let attempt = 1; attempt <= MAX_REFERENCE_CHECK_ATTEMPTS; attempt++) {
      const allMeta = await IntegrationMetadata.query().whereNot('source', SOURCE)

      if (allMeta.length === 0) {
        this.logger.info('Рекламные источники не настроены, ожидание не требуется')
        return
      }

      const pendingSources = allMeta.filter((m) => m.referenceSyncPhase !== ReferenceSyncPhase.DONE)

      if (pendingSources.length === 0) {
        this.logger.info('Все справочные данные рекламных источников загружены успешно')
        return
      }

      for (const meta of pendingSources) {
        if (meta.syncStatus === SyncStatus.ERROR) {
          throw new ApiFatalError(
            `Источник ${meta.source} в статусе ERROR: ${meta.lastError}. Невозможно сопоставить сделки.`
          )
        }

        if (meta.syncStatus === null) {
          this.logger.warn(
            `Источник ${meta.source} ещё не запускался, ожидаем... (попытка ${attempt})`
          )
        } else {
          this.logger.info(
            `Источник ${meta.source} в процессе загрузки (фаза: ${meta.referenceSyncPhase}, статус: ${meta.syncStatus}), ожидаем... (попытка ${attempt})`
          )
        }
      }

      await this.sleep(REFERENCE_CHECK_INTERVAL_MS)
    }

    throw new Error('Ожидание справочников прервано по таймауту (60 сек)')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // -------------------------------------------------------------------------
  // PRIVATE: ID Parsing - Извлечение ID из custom fields
  // -------------------------------------------------------------------------

  private parseIdsFromLead(lead: AmoLead): Set<string> {
    const ids = new Set<string>()
    if (lead.custom_fields_values) {
      for (const field of lead.custom_fields_values) {
        const rawValue = field.values[0]?.value
        if (rawValue === undefined || rawValue === null) continue

        const strValue = String(rawValue)

        const matches = strValue.match(/\d{7,19}/g)
        if (matches) {
          for (const match of matches) {
            const cleanedId = match.replace(/^0+/, '') || '0'
            ids.add(cleanedId)
          }
        }
      }
    }

    if (lead.name) {
      const matches = lead.name.match(/\d{7,19}/g)
      if (matches) {
        for (const match of matches) {
          const cleanedId = match.replace(/^0+/, '') || '0'
          ids.add(cleanedId)
        }
      }
    }

    return ids
  }

  private async findMatchingAdIds(ids: Set<string>): Promise<{
    campaignId: number | null
    groupId: number | null
    adId: number | null
    source: string | null
  }> {
    const idArray = Array.from(ids)

    if (idArray.length === 0) {
      return { campaignId: null, groupId: null, adId: null, source: null }
    }

    const ads = await Ad.query()
      .whereIn(
        'ad_id',
        idArray.map((id) => Number(id))
      )
      .limit(1)
      .first()

    if (ads) {
      const adGroup = await AdGroup.query().where('id', ads.groupId).first()

      return {
        campaignId: adGroup?.campaignId ?? null,
        groupId: adGroup?.id ?? null,
        adId: ads.id,
        source: ads.source,
      }
    }

    const adGroups = await AdGroup.query()
      .whereIn(
        'group_id',
        idArray.map((id) => Number(id))
      )
      .limit(1)
      .first()

    if (adGroups) {
      return {
        campaignId: adGroups.campaignId,
        groupId: adGroups.id,
        adId: null,
        source: adGroups.source,
      }
    }

    const campaigns = await Campaign.query()
      .whereIn(
        'campaign_id',
        idArray.map((id) => Number(id))
      )
      .limit(1)
      .first()

    if (campaigns) {
      return {
        campaignId: campaigns.id,
        groupId: null,
        adId: null,
        source: campaigns.source,
      }
    }

    return { campaignId: null, groupId: null, adId: null, source: null }
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Save to DB
  // -------------------------------------------------------------------------

  private async saveLeadsToDb(
    leads: Awaited<ReturnType<IAmocrmApiClient['getAllLeads']>>
  ): Promise<void> {
    await db.transaction(async (trx) => {
      for (const lead of leads) {
        const createdAt = DateTime.fromSeconds(lead.created_at)
        const updatedAt = DateTime.fromSeconds(lead.updated_at)
        const closedAt = lead.closed_at ? DateTime.fromSeconds(lead.closed_at) : null

        const budget = lead.price || 0

        const parsedIds = this.parseIdsFromLead(lead)
        const {
          campaignId,
          groupId,
          adId,
          source: adSource,
        } = await this.findMatchingAdIds(parsedIds)

        let tagDeal: string | null = null
        let region: string | null = null
        let city: string | null = null
        let product: string | null = null
        let comment: string | null = null
        let website: string | null = null

        if (lead.custom_fields_values) {
          for (const field of lead.custom_fields_values) {
            const code = field.field_code?.toLowerCase()
            const name = field.field_name?.toLowerCase() || ''
            const value = field.values[0]?.value

            if (code === 'tags' || name.includes('тег')) {
              tagDeal = String(value)
            } else if (code === 'region' || name.includes('регион')) {
              region = String(value)
            } else if (code === 'city' || name.includes('город')) {
              city = String(value)
            } else if (code === 'product' || name.includes('продукт')) {
              product = String(value)
            } else if (code === 'comment' || name.includes('комментар')) {
              comment = String(value)
            } else if (name.includes('сайт') || name.includes('website')) {
              website = String(value)
            }
          }
        }

        await CrmRecord.updateOrCreate(
          { source: SOURCE, dealId: String(lead.id) },
          {
            campaignId,
            groupId,
            adId,

            source: SOURCE,
            referrer: adSource || null, // Сохраняем рекламный источник (yandex, avito и т.д.)

            dealName: lead.name,
            dealStage: String(lead.status_id),
            saleFunnel: String(lead.pipeline_id),
            budget,

            recordCreatedAt: createdAt,
            recordUpdatedAt: updatedAt,
            recordClosedTaskAt: closedAt,

            recordCreatedByName: null,
            recordUpdatedByName: null,

            tagDeal,
            region,
            city,
            product,
            comment,
            website,

            price: budget,
          },
          { client: trx }
        )
      }
    })
  }

  // -------------------------------------------------------------------------
  // PRIVATE: Helpers
  // -------------------------------------------------------------------------

  private async getMeta(): Promise<IntegrationMetadata> {
    return IntegrationMetadata.firstOrCreate(
      { source: SOURCE },
      {
        lastTimestamp: null,
        syncStartDate: null,
        syncedUntil: null,
        lastSuccessSyncDate: null,
        syncStatus: null,
        lastError: null,
        referenceSyncPhase: null,
        credentials: null,
      }
    )
  }

  private async handleSyncError(meta: IntegrationMetadata, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof ApiAuthError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = 'auth_unavailable'
      this.logger.error(`Ошибка синхронизации AmoCRM (авторизация): ${message}`)
    } else if (error instanceof ApiFatalError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = message
      this.logger.error(`Фатальная ошибка AmoCRM API: ${message}`)
    } else if (error instanceof ApiLimitError) {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = 'api_limit_exceeded'
      this.logger.error(`Лимит AmoCRM API исчерпан: ${message}`)
    } else if (error instanceof ApiRetryExhaustedError) {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = 'timeout'
      this.logger.warn(`Синхронизация AmoCRM прервана (timeout): ${message}`)
    } else if (error instanceof SyncError) {
      meta.syncStatus = SyncStatus.ERROR
      meta.lastError = message
      this.logger.error(`Ошибка метаданных AmoCRM: ${message}`)
    } else {
      meta.syncStatus = SyncStatus.PARTIAL
      meta.lastError = message
      this.logger.warn(`Синхронизация AmoCRM прервана (partial). Причина: ${message}`)
    }

    await meta.save()
  }
}
