import router from '@adonisjs/core/services/router'

router
  .group(() => {
    router.get('/leads', async () => {})
  })
  .prefix('api/v1/amocrm')
