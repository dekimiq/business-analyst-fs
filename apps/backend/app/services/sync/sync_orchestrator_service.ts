import type { ISyncService } from '#contracts/i_sync_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'
import { SyncServiceFactory } from '#services/sync/sync_service_factory'

/**
 * Оркестратор синхронизации — централизованная точка управления
 * всеми sync-сервисами (Yandex, AmoCRM, etc).
 *
 * Загружает сервисы динамически по требованию через SyncServiceFactory.
 * Это позволяет не хардкодить все сервисы при старте, а создавать их
 * только когда они нужны (с токеном из IntegrationMetadata).
 */
export class SyncOrchestratorService {
  private static instance: SyncOrchestratorService | null = null
  private services: Map<string, ISyncService> = new Map()
  private logger: SyncLoggerService | null = null
  private factory: SyncServiceFactory | null = null

  /**
   * Получает экземпляр Orchestrator из IoC-контейнера или создаёт новый.
   * Используется в jobs и контроллерах для получения сервиса.
   */
  static async init(): Promise<SyncOrchestratorService> {
    if (SyncOrchestratorService.instance) {
      return SyncOrchestratorService.instance
    }

    // Пробуем получить из контейнера AdonisJS
    try {
      const app = await import('@adonisjs/core/app')
      const container = (app as any).container
      const instance = await container.make(SyncOrchestratorService)
      SyncOrchestratorService.instance = instance
      return instance
    } catch {
      // Контейнер недоступен (например, в job runner)
    }

    const instance = new SyncOrchestratorService()
    const logger = new SyncLoggerService('orchestrator')
    instance.initialize(logger)
    SyncOrchestratorService.instance = instance
    return instance
  }

  /**
   * Инициализирует логгер и фабрику сервисов.
   * Вызывается из SyncProvider при boot() или в init() fallback.
   */
  initialize(logger: SyncLoggerService) {
    this.logger = logger
    this.factory = new SyncServiceFactory(logger)
  }

  /**
   * Регистрирует sync-сервис вручную (для тестирования или special cases).
   */
  registerService(service: ISyncService) {
    this.services.set(service.source, service)
    this.logger?.info(`SyncOrchestrator: зарегистрирован сервис для '${service.source}'`)
  }

  /**
   * Получает sync-сервис для указанного источника.
   * Если сервис ещё не загружен — создаёт его через фабрику.
   *
   * @param source - источник ('yandex', 'amocrm')
   * @returns ISyncService или null, если недоступен
   */
  async getService(source: string): Promise<ISyncService | null> {
    // Проверяем кэш
    const cached = this.services.get(source)
    if (cached) {
      return cached
    }

    // Создаём через фабрику
    if (!this.factory) {
      this.logger?.error('SyncOrchestrator: фабрика не инициализирована. Вызовите initialize()')
      return null
    }

    const service = await this.factory.createService(source)
    if (service) {
      this.services.set(source, service)
      this.logger?.info(`SyncOrchestrator: создан и кэширован сервис для '${source}'`)
    }

    return service
  }

  /**
   * Возвращает список всех активных (кэшированных) сервисов.
   */
  getActiveServices(): ISyncService[] {
    return Array.from(this.services.values())
  }

  /**
   * Возвращает список доступных источников из фабрики.
   */
  getAvailableSources(): string[] {
    return SyncServiceFactory.getAvailableSources()
  }
}
