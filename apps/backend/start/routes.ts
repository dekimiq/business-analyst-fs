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

const IntegrationController = () => import('#controllers/integration_controller')

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------
router.get('/swagger', async () => AutoSwagger.default.docs(router.toJSON(), swagger))
router.get('/docs', async () => AutoSwagger.default.ui('/swagger', swagger))

// ---------------------------------------------------------------------------
// Integration management
// ---------------------------------------------------------------------------

// General group
router.get('/status', [IntegrationController, 'index'])
router.post('/tokens/install', [IntegrationController, 'installToken'])
router.post('/notifications/test', [IntegrationController, 'testNotification'])

// AmoCRM group
router
  .group(() => {
    router.post('/config', [IntegrationController, 'setAmocrmConfig'])
  })
  .prefix('/amocrm')

// Sync group
router
  .group(() => {
    router.post('/start-date', [IntegrationController, 'setSyncStartDate'])
    router.post('/force/:source', [IntegrationController, 'forceSync'])
  })
  .prefix('/sync')
