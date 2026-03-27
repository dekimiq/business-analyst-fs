import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ads'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.text('ad_id').notNullable()
      table.integer('group_pk').unsigned().references('id').inTable('ad_groups').onDelete('CASCADE')
      table.string('source').notNullable()
      table.string('status').nullable() // null = активно, 'DELETED' = удалено в Яндексе
      table.string('title').nullable()
      table.text('text').nullable()
      table.string('ad_platform').nullable()
      table.string('condition_name').nullable()
      table.text('condition_id').nullable()

      table.unique(['ad_id', 'source'])

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
