import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class CrmRecord extends BaseModel {
  public static table = 'backend.crm_records'
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare dealId: string | null

  @column({ columnName: 'campaign_pk' })
  declare campaignPk: number | null

  @column({ columnName: 'group_pk' })
  declare groupPk: number | null

  @column({ columnName: 'ad_pk' })
  declare adPk: number | null

  @column()
  declare campaignId: string | null

  @column()
  declare groupId: string | null

  @column()
  declare adId: string | null

  @column()
  declare source: string | null

  @column()
  declare dealStage: string | null

  @column()
  declare dealName: string | null

  @column()
  declare companyName: string | null

  @column()
  declare saleFunnel: string | null

  @column()
  declare budget: number

  @column.dateTime()
  declare recordCreatedAt: DateTime | null

  @column.dateTime()
  declare recordUpdatedAt: DateTime | null

  @column()
  declare recordCreatedByName: string | null

  @column()
  declare recordUpdatedByName: string | null

  @column()
  declare tagDeal: string | null

  @column.dateTime()
  declare recordNextTaskAt: DateTime | null

  @column.dateTime()
  declare recordClosedTaskAt: DateTime | null

  @column()
  declare region: string | null

  @column()
  declare city: string | null

  @column()
  declare comment: string | null

  @column()
  declare price: number

  @column()
  declare product: string | null

  @column()
  declare referrer: string | null

  @column()
  declare website: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
