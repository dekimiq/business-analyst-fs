import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaigns'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table.bigInteger('campaign_id').notNullable()
      table.string('source', 50).notNullable()
      table.string('name', 255).notNullable()
      table.string('type', 50).nullable()
      table.string('status', 50).nullable()
      table.string('state', 50).nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['source', 'campaign_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}