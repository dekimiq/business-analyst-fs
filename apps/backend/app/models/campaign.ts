import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import AdGroup from './ad_group.js'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class Campaign extends BaseModel {
  public static table = 'backend.campaigns'
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare campaignId: number

  @column()
  declare source: string

  @column()
  declare name: string

  @column()
  declare type: string | null

  @column()
  declare status: string | null

  @column()
  declare state: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => AdGroup)
  declare adGroups: HasMany<typeof AdGroup>
}
