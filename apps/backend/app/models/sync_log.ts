import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class SyncLog extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: string

  @column()
  declare level: 'info' | 'warn' | 'error'

  @column()
  declare message: string

  @column()
  declare metadata: any | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /**
   * Удаляет записи старше указанного количества месяцев.
   *
   * @param months - количество месяцев (по умолчанию 3)
   * @returns Количество удаленных записей
   */
  public static async pruneOldLogs(months: number = 3): Promise<number> {
    const cutoffDate = DateTime.now().minus({ months })

    const rows = await this.query().where('created_at', '<', cutoffDate.toSQL()).delete()
    return rows[0] || 0
  }
}
