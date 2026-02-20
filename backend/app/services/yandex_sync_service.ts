// import { DateTime } from 'luxon'
import YandexApiClient from './yandex_api_client_service.js'

export class YandexSyncService {
  private api: YandexApiClient

  constructor() {
    this.api = new YandexApiClient()
  }

  async initialSync() {}
}
