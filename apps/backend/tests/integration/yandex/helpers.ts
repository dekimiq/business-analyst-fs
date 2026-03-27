import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import IntegrationMetadata, { SyncStatus, ReferenceSyncPhase } from '#models/integration_metadata'

// ─── DB helpers ───────────────────────────────────────────────────────────

export async function cleanDatabase() {
  await db.rawQuery(
    'TRUNCATE TABLE backend.integration_metadata, backend.campaigns, backend.ad_groups, backend.ads, backend.daily_stats RESTART IDENTITY CASCADE'
  )
}

// ─── Meta setup ──────────────────────────────────────────────────────────

export interface SetupMetaOptions {
  token?: string | null
  syncStartDate?: DateTime | null
  lastTimestamp?: string | null
  syncStatus?: SyncStatus | null
  lastError?: string | null
  referenceSyncPhase?: ReferenceSyncPhase | null
  historicalSyncState?: Record<string, any> | null
}

export async function setupMeta(opts: SetupMetaOptions = {}): Promise<IntegrationMetadata> {
  const meta = new IntegrationMetadata()
  meta.source = 'yandex'
  meta.credentials = opts.token === null ? null : { long_token: opts.token ?? 'test-token' }
  meta.syncStartDate =
    opts.syncStartDate === undefined
      ? DateTime.now().minus({ days: 30 }).startOf('day')
      : opts.syncStartDate
  meta.lastTimestamp = opts.lastTimestamp ?? null
  meta.syncStatus = opts.syncStatus ?? null
  meta.lastError = opts.lastError ?? null
  meta.referenceSyncPhase = opts.referenceSyncPhase ?? null
  meta.historicalSyncState = opts.historicalSyncState ?? null
  meta.lastSuccessSyncDate = null
  meta.historicalSyncedUntil = null
  await meta.save()
  return meta
}

export async function reloadMeta(): Promise<IntegrationMetadata> {
  return IntegrationMetadata.query().where('source', 'yandex').firstOrFail()
}

// ─── Nock helpers ─────────────────────────────────────────────────────────

export const YANDEX_BASE = 'https://api.direct.yandex.com'

/**
 * Заглушает /reports — чтобы syncDailyStats не ломал тесты структурных фаз.
 */
export function nockReportsEmpty(nockFn: typeof import('nock')) {
  return nockFn(YANDEX_BASE)
    .persist()
    .post('/json/v5/reports')
    .reply(200, 'Date\tAdId\tImpressions\tClicks\tCost\tCtr\tAvgCpc\n', {
      'Content-Type': 'text/plain',
    })
}

/**
 * Заглушает /changes (checkCampaigns) пустым ответом — для syncIncremental в конце цикла.
 * Нужна когда referenceSyncPhase = DONE и тест не проверяет инкрементальный синк.
 */
export function nockChangesEmpty(nockFn: typeof import('nock'), timestamp = 'ts-skip') {
  return nockFn(YANDEX_BASE)
    .post('/json/v5/changes')
    .reply(200, {
      result: {
        Timestamp: timestamp,
        Modified: [],
        NotFound: { CampaignIds: [] },
      },
    })
}
