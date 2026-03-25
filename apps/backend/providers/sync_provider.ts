import type { ApplicationService } from '@adonisjs/core/types'
import { SyncOrchestratorService } from '#services/sync/sync_orchestrator_service'
import { SyncLoggerService } from '#services/sync/sync_logger_service'

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
   */
  async ready() {
    // Регистрируем самостоятельный механизм чистки логов
    const { default: CleanupLogsJob } = await import('#jobs/cleanup_logs_job')

    // Запускаем каждый день в 3:00 ночи
    await CleanupLogsJob.dispatch({ months: 3 }, { repeat: { pattern: '0 3 * * *' } })
  }

  /**
   * Завершение работы перед выключением сервера.
   */
  async shutdown() {}
}
