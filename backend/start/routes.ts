import router from '@adonisjs/core/services/router'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

router.get('/health', async () => {
  return { status: 'ok' }
})

// ---------------------------------------------------------------------------
// Docs (только в режиме разработки)
// ---------------------------------------------------------------------------

router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})

router.get('/docs', async () => {
  return AutoSwagger.default.ui('/swagger', swagger)
})

// ---------------------------------------------------------------------------
// Yandex Direct — настройки
// ---------------------------------------------------------------------------

router
  .group(() => {
    /**
     * @summary Текущие настройки Яндекс.Директ
     * @tag Yandex
     * @responseBody 200 - {"hasToken": true, "syncStartDate": "2024-01-01", "syncStatus": "success"}
     */
    router.get('/yandex/settings', '#controllers/yandex_settings_controller.getSettings')

    /**
     * @summary Установить дату начала синхронизации
     * @tag Yandex
     * @requestBody {"useDefault": true} или {"date": "2024-06-01"}
     * @responseBody 200 - {"syncStartDate": "2024-01-01", "message": "Дата начала синхронизации установлена."}
     */
    router.post('/yandex/settings/sync-date', '#controllers/yandex_settings_controller.setSyncDate')

    /**
     * @summary Сохранить OAuth 2.0 токен Яндекс.Директ
     * @tag Yandex
     * @requestBody {"token": "y0_AgAAAA..."}
     * @responseBody 200 - {"message": "Токен успешно сохранён."}
     */
    router.post('/yandex/settings/token', '#controllers/yandex_settings_controller.saveToken')
  })
  .prefix('/api')

// ---------------------------------------------------------------------------
// Yandex Direct — синхронизация
// ---------------------------------------------------------------------------

router
  .group(() => {
    /**
     * @summary Запустить первичную синхронизацию
     * @description Разрешено только из статуса null (первый старт). Требует настроенной sync_start_date.
     * @tag Sync
     * @responseBody 202 - {"message": "string", "jobId": "string"}
     * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string"}
     * @responseBody 409 - {"error": "string", "syncStatus": "string"}
     */
    router.post('/sync/yandex/initial', '#controllers/yandex_sync_controller.triggerInitialSync')

    /**
     * @summary Ежедневная синхронизация (ручной триггер)
     * @description Разрешено из: success, partial. При partial — сначала вчера, потом продолжает initial.
     * @tag Sync
     * @responseBody 202 - {"message": "string", "jobId": "string"}
     * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string"}
     */
    router.post('/sync/yandex/daily', '#controllers/yandex_sync_controller.triggerDailySync')

    /**
     * @summary Возобновить синхронизацию из error или partial
     * @description При error — сначала dailySync потом initial. При partial — аналогично.
     * @tag Sync
     * @responseBody 202 - {"message": "string", "jobId": "string"}
     * @responseBody 423 - {"error": "sync_locked", "syncStatus": "string"}
     * @responseBody 409 - {"error": "string", "syncStatus": "string"}
     */
    router.post(
      '/sync/yandex/continuation',
      '#controllers/yandex_sync_controller.triggerContinuation'
    )

    /**
     * @summary Статус синхронизации
     * @description Доступен всегда. Возвращает syncStatus, даты и последнюю ошибку.
     * @tag Sync
     * @responseBody 200 - {"syncStatus": "string", "syncStartDate": "string", "currentSyncDate": "string", "lastSyncAt": "string", "lastError": "string"}
     */
    router.get('/sync/yandex/status', '#controllers/yandex_sync_controller.getStatus')
  })
  .prefix('/api')
