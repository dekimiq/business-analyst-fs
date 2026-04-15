import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import Campaign from './campaign.js'
import Ad from './ad.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class AdGroup extends BaseModel {
  public static table = 'backend.ad_groups'
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare groupId: string

  @column({ columnName: 'campaign_pk' })
  declare campaignPk: number

  @column()
  declare source: string

  @column()
  declare name: string

  @column()
  declare status: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Campaign, {
    foreignKey: 'campaignPk',
  })
  declare campaign: BelongsTo<typeof Campaign>

  @hasMany(() => Ad)
  declare ads: HasMany<typeof Ad>
}
