import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaigns'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.text('campaign_id').notNullable()
      table.string('source').notNullable()
      table.string('name').notNullable()
      table.string('type').nullable()
      table.string('status').nullable()
      table.string('state').nullable()

      table.unique(['campaign_id', 'source'])

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
