import IntegrationMetadata, { ReferenceSyncPhase } from '#models/integration_metadata'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class IntegrationMetadataSeeder extends BaseSeeder {
  async run() {
    const sources = [
      {
        source: 'yandex' as const,
        credentials: {
          long_token: null,
        },
      },
      {
        source: 'amocrm' as const,
        credentials: {
          domain: null,
          client_id: null,
          client_secret: null,
          long_token: null,
        },
      },
    ]

    for (const { source, credentials } of sources) {
      await IntegrationMetadata.firstOrCreate(
        { source },
        {
          lastTimestamp: null,
          syncStartDate: null,
          historicalSyncedUntil: null,
          lastSuccessSyncDate: null,
          syncStatus: null,
          referenceSyncPhase: null,
          lastError: null,
          credentials,
        }
      )
    }
  }
}
