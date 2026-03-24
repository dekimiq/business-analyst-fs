import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import Ad from './ad.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class DailyStat extends BaseModel {
  public static table = 'backend.daily_stats'
  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'ad_pk' })
  declare adPk: number

  @column.date()
  declare date: DateTime

  @column()
  declare impressions: number

  @column()
  declare clicks: number

  @column()
  declare ctr: number

  @column()
  declare cost: number

  @column()
  declare avgCpc: number | null

  @column()
  declare avgCpm: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Ad, {
    foreignKey: 'adPk',
  })
  declare ad: BelongsTo<typeof Ad>
}
