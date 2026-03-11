import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'integration_metadata'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('source', 50).notNullable().unique()
      table.text('token').nullable()
      table.string('last_timestamp').nullable()
      table.date('sync_start_date').nullable()

      table.date('synced_until').nullable()

      table.timestamp('last_success_sync_at').nullable()

      table.string('sync_status', 20).nullable().comment('partial | success | error | null')
      table
        .string('reference_sync_phase', 20)
        .nullable()
        .comment('campaigns | adGroups | ads | done')
      table.text('last_error').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
