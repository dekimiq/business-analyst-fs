import router from '@adonisjs/core/services/router'

router
  .group(() => {
    router.get('/reports', async () => {})
  })
  .prefix('api/v1/analytics')
