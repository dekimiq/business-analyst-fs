import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ad_groups'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table.bigInteger('group_id').notNullable()
      table.bigInteger('campaign_id').unsigned().references('id').inTable('campaigns').onDelete('CASCADE')
      table.string('source', 50).notNullable()
      table.string('name', 255).notNullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['source', 'group_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}