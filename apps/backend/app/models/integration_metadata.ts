import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import encryption from '@adonisjs/core/services/encryption'

export enum SyncStatus {
  PARTIAL = 'partial', // Legacy, keep for AmoCRM compatibility for now
  ERROR = 'error', // Legacy, keep for AmoCRM compatibility for now

  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum ReferenceSyncPhase {
  TIMESTAMP = 'timestamp',
  CAMPAIGNS = 'campaigns',
  AD_GROUPS = 'adGroups',
  ADS = 'ads',
  CRM_PIPELINES = 'crm_pipelines',
  DONE = 'done',
}

export default class IntegrationMetadata extends BaseModel {
  public static table = 'backend.integration_metadata'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: string

  @column()
  declare lastTimestamp: string | null

  @column.date()
  declare syncStartDate: DateTime | null

  @column.date()
  declare historicalSyncedUntil: DateTime | null

  @column({
    prepare: (value) => (value ? JSON.stringify(value) : null),
    consume: (value) => (value ? (typeof value === 'string' ? JSON.parse(value) : value) : null),
  })
  declare historicalSyncState: Record<string, any> | null

  @column.date()
  declare lastSuccessSyncDate: DateTime | null

  @column()
  declare syncStatus: SyncStatus | null

  @column()
  declare referenceSyncPhase: ReferenceSyncPhase | null

  @column()
  declare lastError: string | null

  @column({
    serializeAs: null,
    /**
     * Дешифруем credentials при получении из базы
     */
    consume: (value) => {
      if (!value) return null
      if (typeof value !== 'string') return value
      try {
        return encryption.decrypt(value)
      } catch {
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }
    },
    /**
     * Шифруем credentials перед сохранением в базу
     */
    prepare: (value) => {
      if (!value) return null
      return encryption.encrypt(value)
    },
  })
  declare credentials: Record<string, any> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
