import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import AdGroup from './ad_group.js'
import DailyStat from './daily_stat.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Ad extends BaseModel {
  public static table = 'backend.ads'
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare adId: number

  @column()
  declare groupId: number

  @column()
  declare source: string

  @column()
  declare title: string | null

  @column()
  declare text: string | null

  @column()
  declare adPlatform: string | null

  @column()
  declare conditionName: string | null

  @column()
  declare conditionId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => AdGroup)
  declare adGroup: BelongsTo<typeof AdGroup>

  @hasMany(() => DailyStat)
  declare dailyStats: HasMany<typeof DailyStat>
}
