import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ads'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table.bigInteger('ad_id').notNullable()
      table.bigInteger('group_id').unsigned().references('id').inTable('ad_groups').onDelete('CASCADE')
      table.string('source', 50).notNullable()
      table.string('title', 255).nullable()
      table.text('text').nullable()
      table.string('ad_platform', 100).nullable()
      table.string('condition_name', 255).nullable()
      table.bigInteger('condition_id').nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['source', 'ad_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}