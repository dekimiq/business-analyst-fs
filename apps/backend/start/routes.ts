/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

const SyncStatusController = () => import('#controllers/sync/sync_status_controller')
const YandexIntegrationController = () => import('#controllers/sync/yandex_integration_controller')

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------
router.get('/swagger', async () => AutoSwagger.default.docs(router.toJSON(), swagger))
router.get('/docs', async () => AutoSwagger.default.ui('/swagger', swagger))

// ---------------------------------------------------------------------------
// Sync routes
// ---------------------------------------------------------------------------
router
  .group(() => {
    router.get('/status', [SyncStatusController, 'index'])

    router
      .group(() => {
        router.get('/status', [YandexIntegrationController, 'status'])
        router.post('/setup', [YandexIntegrationController, 'setupSettings'])
        router.post('/token', [YandexIntegrationController, 'updateToken'])
        router.post('/sync', [YandexIntegrationController, 'sync'])
      })
      .prefix('/yandex')
  })
  .prefix('/sync')
