import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'integration_metadata'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('source', 50).notNullable().unique()
      table.text('token').defaultTo(null)
      table.string('last_timestamp').defaultTo(null).comment('Последний timestamp, полученный от сервиса проверки изменений')
      table.date('sync_start_date').defaultTo(null).comment('	Дата начала первичной загрузки (точка отсчёта)')
      table.date('current_sync_date').defaultTo(null).comment('Последняя дата, за которую успешно загружены данные')
      table.timestamp('last_sync_at').nullable().defaultTo(null).comment('Время последней попытки синхронизации')
      table.string('sync_status', 20).nullable().defaultTo(null).comment('null | pending | partial | success | error')
      table.string('structural_sync_phase', 20).nullable().defaultTo('campaigns').comment('campaigns | adGroups | ads | done')
      table.text('last_error').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}