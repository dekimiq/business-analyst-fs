import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'crm_pipelines'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigInteger('id').primary().notNullable()
      table.string('name').notNullable()
      table.integer('sort').defaultTo(0)
      table.boolean('is_main').defaultTo(false)
      table.string('source').notNullable().index()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
