import IntegrationMetadata, { ReferenceSyncPhase } from '#models/integration_metadata'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class IntegrationMetadataSeeder extends BaseSeeder {
  async run() {
    const sources = [
      {
        source: 'yandex' as const,
        config: null,
      },
      {
        source: 'amocrm' as const,
        config: {
          domain: null,
          client_id: null,
          client_secret: null,
        },
      },
    ]

    for (const { source, config } of sources) {
      await IntegrationMetadata.firstOrCreate(
        { source },
        {
          token: null,
          lastTimestamp: null,
          syncStartDate: null,
          syncedUntil: null,
          lastSuccessSyncDate: null,
          syncStatus: null,
          referenceSyncPhase: null,
          lastError: null,
          config,
        }
      )
    }
  }
}
