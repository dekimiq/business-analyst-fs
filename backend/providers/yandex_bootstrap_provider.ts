import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Провайдер bootstrap-инициализации Яндекс-интеграции.
 *
 * Гарантирует что при старте приложения в таблице integration_metadata
 * существует запись с source='yandex' и дефолтными null-значениями.
 *
 * Почему ready(), а не boot():
 *  - boot() вызывается до соединения с БД
 *  - ready() вызывается после того как все провайдеры (включая database_provider)
 *    инициализированы и HTTP-сервер готов принимать запросы
 *
 * Не запускается в тестовом окружении (environment: ['web', 'console']),
 * чтобы не мешать unit-тестам без БД.
 */
export default class YandexBootstrapProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    // Импортируем внутри ready() — к этому моменту Lucid уже инициализирован
    const { default: IntegrationMetadata } = await import('#models/integration_metadata')

    const meta = await IntegrationMetadata.firstOrCreate(
      { source: 'yandex' },
      {
        token: null,
        lastTimestamp: null,
        syncStartDate: null,
        currentSyncDate: null,
        lastSyncAt: null,
        syncStatus: null,
        lastError: null,
      }
    )

    if (meta.$isLocal) {
      console.log(
        '[Bootstrap] integration_metadata: запись yandex создана с дефолтными значениями.'
      )
    }
  }
}
