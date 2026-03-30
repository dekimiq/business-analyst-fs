import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CrmPipeline from './crm_pipeline.js'

export default class CrmStatus extends BaseModel {
  public static table = 'backend.crm_statuses'

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare pipelineId: string

  @column()
  declare name: string

  @column()
  declare color: string | null

  @column()
  declare sort: number

  @column()
  declare type: string | null

  @column()
  declare source: string

  @belongsTo(() => CrmPipeline, {
    foreignKey: 'pipelineId',
  })
  declare pipeline: BelongsTo<typeof CrmPipeline>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
