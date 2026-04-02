import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import type { ISyncService } from '#contracts/i_sync_service'
import type { IAmocrmApiClient } from '#contracts/i_amocrm_api_client'
import { SyncLoggerService } from '#services/sync/sync_logger_service'
import type { AmocrmSyncContext } from './amocrm_sync_context.js'
import { syncPipelinesAndStatuses } from './structural_sync.js'
import { incrementalSync } from './incremental_sync.js'
import { historicalSync } from './historical_sync.js'
import {
  MetaTokenUnavailableError,
  MetaSyncStartDateUnavailableError,
} from '#exceptions/sync_exceptions'
import { ApiLimitError } from '#exceptions/api_exceptions'
import { DateTime } from 'luxon'

const SOURCE = 'amocrm'

/**
 * Фасад сервиса синхронизации AmoCRM.
 * Реализует двухэтапную стратегию:
 * 1. Легкий синк (Incremental) — через Events API каждые 30 минут.
 * 2. Тяжелый синк (Heavy) — полная сверка раз в сутки или при первом запуске.
 */
export class AmocrmSyncServiceFacade implements ISyncService {
  public readonly source = SOURCE
  private readonly logger: SyncLoggerService

  constructor(private readonly api: IAmocrmApiClient) {
    this.logger = new SyncLoggerService(SOURCE)
  }

  /**
   * Основной метод синхронизации.
   *
   * @param force - игнорировать статус ошибки и запустить принудительно
   * @param mode - 'light' (инкрементально) или 'heavy' (исторически + структура)
   */
  async sync(force: boolean = false, mode?: 'light' | 'heavy'): Promise<void> {
    const meta = await this.getOrCreateMeta()

    // 1. Сброс зависшей сессии.
    if (meta.syncStatus === SyncStatus.IN_PROGRESS) {
      this.logger.warn(
        `[AmoCRM] Обнаружена зависшая сессия (IN_PROGRESS). Сбрасываем статус в PENDING для повторного запуска.`
      )
      meta.syncStatus = SyncStatus.PENDING
      await meta.save()
    }

    if (meta.syncStatus === SyncStatus.FAILED && !force) {
      this.logger.warn(`[AmoCRM] Сервис в статусе FAILED. Требуется принудительный запуск (force).`)
      return
    }

    const effectiveMode = mode || (meta.lastTimestamp ? 'light' : 'heavy')

    const context: AmocrmSyncContext = {
      source: SOURCE,
      api: this.api,
      logger: this.logger,
      meta,
      force,
      mode: effectiveMode,
    }

    try {
      // 2. Валидация конфигурации ПЕРЕД стартом (уходим в ожидание если данных нет)
      const credentials = meta.credentials as any
      if (
        !credentials?.long_token ||
        !credentials?.domain ||
        !credentials?.client_id ||
        !credentials?.client_secret
      ) {
        throw new MetaTokenUnavailableError()
      }
      if (!meta.syncStartDate) {
        throw new MetaSyncStartDateUnavailableError()
      }

      // 3. Переводим в рабочее состояние
      meta.syncStatus = SyncStatus.IN_PROGRESS
      meta.lastError = null
      await meta.save()

      this.logger.info(`[AmoCRM] Старт цикла синхронизации в режиме: ${effectiveMode}`)

      // 3. Структурная синхронизация (Воронки и Статусы)
      if (meta.referenceSyncPhase !== ReferenceSyncPhase.DONE || effectiveMode === 'heavy') {
        this.logger.info(`[AmoCRM] [Phase] Синхронизация структуры (CRM_PIPELINES)...`)
        meta.referenceSyncPhase = ReferenceSyncPhase.CRM_PIPELINES
        await meta.save()

        await syncPipelinesAndStatuses(context)

        meta.referenceSyncPhase = ReferenceSyncPhase.DONE
        await meta.save()
      }

      // 4. Синхронизация данных
      if (effectiveMode === 'heavy') {
        // Сначала подтягиваем "онлайн" (последние изменения),
        // чтобы актуалка была в приоритете.
        await incrementalSync(context)
        // Затем идем копать историю вглубь
        await historicalSync(context)
      } else {
        await incrementalSync(context)
      }

      // 5. Финализация
      meta.syncStatus = SyncStatus.SUCCESS
      meta.lastSuccessSyncDate = DateTime.utc()
      await meta.save()

      this.logger.info(`[AmoCRM] Цикл синхронизации (${effectiveMode}) успешно завершен.`)

      // 6. Запуск пайплайна обогащения
      try {
        const EnrichmentJob = (await import('#jobs/lead_enrichment_job')).default
        await EnrichmentJob.dispatch({})
        this.logger.info(`[AmoCRM] Пайплайн обогащения сделок передан в очередь.`)
      } catch (err) {
        this.logger.error(`[AmoCRM] Ошибка запуска пайплайна обогащения: ${(err as Error).message}`)
      }
    } catch (error) {
      await this.handleError(context, error)
      throw error
    }
  }

  /**
   * Получает или создает запись метаданных в БД.
   */
  private async getOrCreateMeta(): Promise<IntegrationMetadata> {
    return IntegrationMetadata.firstOrCreate(
      { source: SOURCE },
      {
        syncStatus: null,
        referenceSyncPhase: null,
        lastTimestamp: null,
        syncStartDate: null,
        credentials: {
          long_token: null,
          domain: null,
          client_id: null,
          client_secret: null,
        },
      }
    )
  }

  /**
   * Обработка ошибок синхронизации.
   */
  private async handleError(ctx: AmocrmSyncContext, error: unknown): Promise<void> {
    const { meta, logger } = ctx
    const message = error instanceof Error ? error.message : String(error)

    if (error instanceof ApiLimitError) {
      meta.syncStatus = SyncStatus.PARTIAL
    } else {
      meta.syncStatus = SyncStatus.FAILED
    }

    meta.lastError = message
    await meta.save()
    logger.error(`[AmoCRM] Ошибка цикла синхронизации: ${message}`)
  }
}
