import router from '@adonisjs/core/services/router'

router
  .group(() => {
    router.get('/ads', async () => {})
  })
  .prefix('api/v1/yandex')
