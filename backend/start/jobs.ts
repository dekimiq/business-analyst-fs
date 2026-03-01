// Регистрация обработчиков BullMQ-джобов.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const jobs: Record<string, Function> = {
  yandex_sync_job: () => import('#jobs/yandex_sync_job'),
}

export { jobs }
