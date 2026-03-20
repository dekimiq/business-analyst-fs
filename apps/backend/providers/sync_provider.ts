import type { ApplicationService } from '@adonisjs/core/types'
import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'
import type { SyncWorkerService } from '#services/sync_worker_service'

/**
 * Service Provider для регистрации сервисов синхронизации в IoC-контейнере.
 *
 * Здесь регистрируются:
 * - SyncOrchestratorService — главный оркестратор синхронизации
 * - SyncLoggerService — логирование синхронизации
 *
 * При добавлении нового источника (например, AmoCRM):
 * 1. Создайте сервис синхронизации, реализующий ISyncService
 * 2. Создайте API-клиент для источника
 * 3. Зарегистрируйте API-клиент в этом провайдере
 * 4. Добавьте регистрацию sync-сервиса в SyncServiceFactory
 */
export default class SyncProvider {
  private workerService: typeof SyncWorkerService.prototype | null = null

  constructor(protected app: ApplicationService) {}

  /**
   * Регистрация сервисов в IoC-контейнере.
   * Вызывается при запуске приложения ДО boot().
   */
  register() {
    // Регистрируем логгер как синглтон
    this.app.container.singleton(SyncLoggerService, () => {
      return new SyncLoggerService('system')
    })

    // Регистрируем оркестратор как синглтон
    this.app.container.singleton(SyncOrchestratorService, () => {
      return new SyncOrchestratorService()
    })
  }

  /**
   * Инициализация сервисов после регистрации.
   * Здесь безопасно получаем зависимости из контейнера.
   */
  async boot() {
    const orchestrator = await this.app.container.make(SyncOrchestratorService)
    const logger = await this.app.container.make(SyncLoggerService)

    orchestrator.initialize(logger)
  }

  /**
   * Запускается, когда приложение (HTTP-сервер) полностью готово к работе.
   * Стартуем воркер только в 'web' окружении, чтобы не блокировать ace-команды.
   */
  async ready() {
    if (this.app.getEnvironment() === 'web') {
      const { SyncWorkerService: WorkerService } = await import('#services/sync_worker_service')
      this.workerService = new WorkerService()
      this.workerService.start()
    }
  }

  /**
   * Завершение работы перед выключением сервера.
   */
  async shutdown() {
    if (this.workerService) {
      await this.workerService.close()
    }
  }
}
