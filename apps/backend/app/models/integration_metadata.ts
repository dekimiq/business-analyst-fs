import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import encryption from '@adonisjs/core/services/encryption'

export enum SyncStatus {
  PARTIAL = 'partial',
  SUCCESS = 'success',
  ERROR = 'error',
}

export enum ReferenceSyncPhase {
  TIMESTAMP = 'timestamp',
  CAMPAIGNS = 'campaigns',
  AD_GROUPS = 'adGroups',
  ADS = 'ads',
  DONE = 'done',
}

export default class IntegrationMetadata extends BaseModel {
  public static table = 'integration_metadata'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: string

  @column()
  declare lastTimestamp: string | null

  @column.date()
  declare syncStartDate: DateTime | null

  @column.date()
  declare syncedUntil: DateTime | null

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
