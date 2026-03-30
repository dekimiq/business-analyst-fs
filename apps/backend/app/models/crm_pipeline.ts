import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import CrmStatus from './crm_status.js'

export default class CrmPipeline extends BaseModel {
  public static table = 'backend.crm_pipelines'

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare name: string

  @column()
  declare sort: number

  @column()
  declare isMain: boolean

  @column()
  declare source: string

  @hasMany(() => CrmStatus, {
    foreignKey: 'pipelineId',
  })
  declare statuses: HasMany<typeof CrmStatus>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
