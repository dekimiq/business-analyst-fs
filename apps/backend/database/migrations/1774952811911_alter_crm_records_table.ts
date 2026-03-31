import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'crm_records'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('match_retry_count').notNullable().defaultTo(0)
      table.timestamp('next_match_retry_at', { useTz: true }).nullable().index()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumns('match_retry_count', 'next_match_retry_at')
    })
  }
}
