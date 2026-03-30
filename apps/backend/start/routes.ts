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

const AmocrmController = () => import('#controllers/amocrm/amocrm_controller')
const GlobalController = () => import('#controllers/global/global_controller')
const SystemController = () => import('#controllers/system/system_controller')

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------
router.get('/swagger', async () => AutoSwagger.default.docs(router.toJSON(), swagger))
router.get('/docs', async () => AutoSwagger.default.ui('/swagger', swagger))

// ---------------------------------------------------------------------------
// Global group (Статусы, токены)
// ---------------------------------------------------------------------------
router.get('/status', [GlobalController, 'getStatus'])
router.post('/tokens/install', [GlobalController, 'installToken'])

// ---------------------------------------------------------------------------
// AmoCRM group (Конфигурация)
// ---------------------------------------------------------------------------
router
  .group(() => {
    router.post('/config', [AmocrmController, 'setConfig'])
  })
  .prefix('/amocrm')

// ---------------------------------------------------------------------------
// System group (Обслуживание, синхронизация)
// ---------------------------------------------------------------------------
router
  .group(() => {
    router.post('/notifications/test', [SystemController, 'testNotification'])
    router.post('/sync-start-date', [SystemController, 'setSyncStartDate'])
    router.post('/force-sync/:source', [SystemController, 'forceSync'])
    router.post('/cron-sync', [SystemController, 'cronSync'])
  })
  .prefix('/system')

// @TODO: Добавить группу Analytics после обсуждения ТЗ
