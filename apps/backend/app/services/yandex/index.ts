import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import type { ISyncService } from '#contracts/i_sync_service'
import type { IYandexApiClient } from '#contracts/i_yandex_api_client'
import { SyncLoggerService } from '#services/sync/sync_logger_service'
import type { YandexSyncContext } from './yandex_sync_context.js'
import { syncTimestamp, syncCampaigns, syncAdGroups, syncAds } from './structural_sync.js'
import { syncDailyStats } from './daily_stats_sync.js'
import { syncHistoricalStats } from './historical_stats_sync.js'
import { syncIncremental } from './incremental_sync.js'
import {
  MetaTokenUnavailableError,
  MetaSyncStartDateUnavailableError,
} from '#exceptions/sync_exceptions'
import { ApiFatalError, ApiLimitError } from '#exceptions/api_exceptions'

const SOURCE = 'yandex'

export class YandexSyncServiceFacade implements ISyncService {
  public readonly source = SOURCE
  private readonly logger: SyncLoggerService

  constructor(private readonly api: IYandexApiClient) {
    this.logger = new SyncLoggerService(SOURCE)
  }

  /**
   * Главная точка входа для фонового Job'а.
   * Контролирует машину состояний: PENDING, IN_PROGRESS, SUCCESS, FAILED.
   */
  async sync(force: boolean = false): Promise<void> {
    const meta = await this.getOrCreateMeta()

    // 1. Сброс зависшей сессии.
    // Если по расписанию приходит новый запуск, а старый висит в IN_PROGRESS дольше нужного (или просто запускается заново),
    // сбрасываем IN_PROGRESS. В рамках одного процесса Job не вызовет sync() одновременно благодаря локам очереди.
    if (meta.syncStatus === SyncStatus.IN_PROGRESS) {
      this.logger.warn(
        `Обнаружена зависшая сессия (IN_PROGRESS). Сбрасываем статус в PENDING для повторного запуска.`
      )
      meta.syncStatus = SyncStatus.PENDING
      await meta.save()
    }

    if (!force && meta.syncStatus === SyncStatus.FAILED) {
      this.logger.warn(
        `Синхронизация пропущена: статус FAILED. Требуется ручной перезапуск (force).`
      )
      return
    }

    if (force && meta.syncStatus === SyncStatus.FAILED) {
      this.logger.info(`Принудительный запуск из состояния FAILED`)
      meta.syncStatus = SyncStatus.PENDING
      await meta.save()
    }

    this.logger.info(
      `Старт цикла синхронизации. Текущий статус перед стартом: ${meta.syncStatus || 'null'}`
    )

    // 2. Переводим в рабочее состояние
    meta.syncStatus = SyncStatus.IN_PROGRESS
    meta.lastError = null
    await meta.save()

    const context: YandexSyncContext = {
      source: SOURCE,
      api: this.api,
      logger: this.logger,
      meta,
      force,
    }

    try {
      if (!meta.credentials?.long_token) {
        throw new MetaTokenUnavailableError()
      }
      if (!meta.syncStartDate) {
        throw new MetaSyncStartDateUnavailableError()
      }

      // 3. Структурный синк (машина состояний по фазам — запускается один раз)
      await this.runStructuralSyncPhases(context)

      // 4. Инкрементальный синк структуры (Changes API — только изменения с lastTimestamp)
      await syncIncremental(context)

      // 5. Ежедневная статистика (учитывает statBorderDate из шага 4)
      await syncDailyStats(context)

      // 6. Историческая ретроспективная загрузка (через оффлайн очередь)
      await syncHistoricalStats(context)

      // 7. Успешное завершение
      meta.syncStatus = SyncStatus.SUCCESS
      await meta.save()
      this.logger.info(`Синхронизация Яндекса завершена успешно!`)
    } catch (error) {
      await this.handleError(context, error)
      throw error // Пробрасываем ошибку для Job'а
    }
  }

  /**
   * Стейт-машина фаз структурных данных.
   * Движется от TIMESTAMP до DONE. Позволяет легко возобновить с места сбоя.
   */
  private async runStructuralSyncPhases(ctx: YandexSyncContext): Promise<void> {
    const { meta, logger } = ctx

    if (!meta.referenceSyncPhase) {
      meta.referenceSyncPhase = ReferenceSyncPhase.TIMESTAMP
      await meta.save()
    }

    while (meta.referenceSyncPhase !== ReferenceSyncPhase.DONE) {
      switch (meta.referenceSyncPhase) {
        case ReferenceSyncPhase.TIMESTAMP:
          logger.info(`[Phase] Получение Timestamp...`)
          await syncTimestamp(ctx)

          if (!meta.lastTimestamp) {
            throw new ApiFatalError('timestamp_save_failed')
          }

          meta.referenceSyncPhase = ReferenceSyncPhase.CAMPAIGNS
          await meta.save()
          await meta.refresh()
          break

        case ReferenceSyncPhase.CAMPAIGNS:
          logger.info(`[Phase] Синхронизация кампаний...`)
          await syncCampaigns(ctx)
          meta.referenceSyncPhase = ReferenceSyncPhase.AD_GROUPS
          await meta.save()
          await meta.refresh()
          break

        case ReferenceSyncPhase.AD_GROUPS:
          logger.info(`[Phase] Синхронизация групп объявлений...`)
          await syncAdGroups(ctx)
          meta.referenceSyncPhase = ReferenceSyncPhase.ADS
          await meta.save()
          await meta.refresh()
          break

        case ReferenceSyncPhase.ADS:
          logger.info(`[Phase] Синхронизация объявлений...`)
          await syncAds(ctx)
          meta.referenceSyncPhase = ReferenceSyncPhase.DONE
          await meta.save()
          await meta.refresh()
          break

        default:
          throw new Error(`Неизвестная фаза: ${meta.referenceSyncPhase}`)
      }
    }

    logger.info(`Структурные справочники актуальны (Фаза DONE)`)
  }

  private async getOrCreateMeta(): Promise<IntegrationMetadata> {
    return IntegrationMetadata.firstOrCreate(
      { source: SOURCE },
      {
        lastTimestamp: null,
        syncStartDate: null,
        historicalSyncedUntil: null,
        historicalSyncState: null,
        lastSuccessSyncDate: null,
        syncStatus: null,
        lastError: null,
        referenceSyncPhase: null,
        credentials: {
          long_token: null,
        },
      }
    )
  }

  private async handleError(ctx: YandexSyncContext, error: unknown): Promise<void> {
    const { meta, logger } = ctx
    let message = error instanceof Error ? error.message : String(error)

    if (error instanceof ApiLimitError) {
      meta.syncStatus = SyncStatus.PARTIAL
    } else {
      meta.syncStatus = SyncStatus.FAILED
    }

    meta.lastError = message
    await meta.save()
    await meta.refresh()

    logger.error(`Синхронизация Яндекс прервана: ${message}`)
  }
}
