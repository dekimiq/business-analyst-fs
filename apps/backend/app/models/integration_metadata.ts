import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export enum SyncStatus {
  INITIALIZING = 'initializing',
  PENDING = 'pending',
  PARTIAL = 'partial',
  SUCCESS = 'success',
  ERROR = 'error',
}

export enum ReferenceSyncPhase {
  CAMPAIGNS = 'campaigns',
  AD_GROUPS = 'adGroups',
  ADS = 'ads',
  DONE = 'done',
}

// TODO: Добить список, он не полный
export enum SyncErrorCode {
  NETWORK = 'network',
  TOKEN_UNAVAILABLE = 'token_unavailable',
  EXHAUSTED_COUNT = 'exhausted_count',
  API_LIMIT = 'api_limit',
  UNKNOWN = 'unknown',
}

export default class IntegrationMetadata extends BaseModel {
  public static table = 'integration_metadata'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: 'yandex' | 'amocrm'

  @column()
  declare token: string | null

  @column()
  declare lastTimestamp: string | null

  @column.date()
  declare syncStartDate: DateTime | null

  @column.date()
  declare currentSyncDate: DateTime | null

  @column.dateTime()
  declare lastSyncAt: DateTime | null

  @column()
  declare syncStatus: SyncStatus | null

  @column()
  declare referenceSyncPhase: ReferenceSyncPhase

  @column()
  declare lastError: SyncErrorCode | string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
