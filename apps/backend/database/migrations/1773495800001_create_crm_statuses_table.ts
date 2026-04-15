import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'crm_statuses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigInteger('id').primary().notNullable()
      table.bigInteger('pipeline_id').notNullable().index()
      table.string('name').notNullable()
      table.string('color').nullable()
      table.integer('sort').defaultTo(0)
      table.string('type').nullable().comment('142: work, 143: won, etc')
      table.string('source').notNullable().index()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
