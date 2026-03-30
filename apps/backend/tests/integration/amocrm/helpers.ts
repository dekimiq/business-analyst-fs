import db from '@adonisjs/lucid/services/db'
import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'
import { DateTime } from 'luxon'
import CrmRecord from '#models/crm_record'
import CrmPipeline from '#models/crm_pipeline'
import CrmStatus from '#models/crm_status'

export const AMOCRM_BASE = 'https://ratelead.amocrm.ru'

export async function cleanDatabase() {
  await CrmRecord.query().delete()
  await CrmPipeline.query().delete()
  await CrmStatus.query().delete()
  await IntegrationMetadata.query().delete()
}

export async function setupMeta(overrides: Partial<any> = {}) {
  const meta = new IntegrationMetadata()
  meta.fill({
    source: 'amocrm',
    syncStatus: SyncStatus.PENDING,
    referenceSyncPhase: null,
    syncStartDate: DateTime.now().minus({ days: 30 }),
    credentials: {
      domain: 'ratelead.amocrm.ru',
      client_id: 'test_client_id',
      client_secret: 'test_client_secret',
      long_token: 'test_access_token',
    },
    ...overrides,
  })
  await meta.save()
  return meta
}

export async function reloadMeta() {
  return await IntegrationMetadata.query().where('source', 'amocrm').firstOrFail()
}
