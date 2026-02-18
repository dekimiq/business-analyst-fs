import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Ad extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare campaignId: number

  @column()
  declare groupId: number

  @column()
  declare adId: number

  @column()
  declare source: string

  @column()
  declare campaignName: string

  @column()
  declare groupName: string

  @column()
  declare conditionName: string

  @column()
  declare conditionId: number

  @column()
  declare adPlatform: string

  @column()
  declare title: string

  @column()
  declare text: string

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
}
