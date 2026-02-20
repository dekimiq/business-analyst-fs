import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import Campaign from './campaign.js'
import Ad from './ad.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class AdGroup extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare groupId: number

  @column()
  declare campaignId: number

  @column()
  declare source: string

  @column()
  declare name: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Campaign)
  declare campaign: BelongsTo<typeof Campaign>

  @hasMany(() => Ad)
  declare ads: HasMany<typeof Ad>
}
