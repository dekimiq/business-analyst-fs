import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ad_groups'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.text('group_id').notNullable()
      table
        .integer('campaign_pk')
        .unsigned()
        .references('id')
        .inTable('campaigns')
        .onDelete('CASCADE')
      table.string('source').notNullable()
      table.string('name').notNullable()

      table.unique(['group_id', 'source'])

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
