import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import encryption from '@adonisjs/core/services/encryption'

export default class IntegrationMetadata extends BaseModel {
  static table = 'integration_metadata'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: string

  @column({
    prepare: (value: string | null) => (value ? encryption.encrypt(value) : null),
    consume: (value: string | null) => (value ? encryption.decrypt(value) : null),
  })
  declare token: string | null

  @column()
  declare lastTimestamp: number | null

  @column.date()
  declare syncStartDate: DateTime | null

  @column.date()
  declare currentSyncDate: DateTime | null

  @column.dateTime()
  declare lastSyncAt: DateTime | null

  @column()
  declare syncStatus: 'pending' | 'partial' | 'success' | 'error' | null

  @column()
  declare lastError: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
