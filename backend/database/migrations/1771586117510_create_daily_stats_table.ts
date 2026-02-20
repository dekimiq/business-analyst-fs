import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'daily_stats'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table.bigInteger('ad_id').unsigned().references('id').inTable('ads').onDelete('CASCADE')
      table.date('date').notNullable()
      table.bigInteger('impressions').defaultTo(0)
      table.bigInteger('clicks').defaultTo(0)
      table.decimal('ctr', 5, 2).defaultTo(0)
      table.decimal('cost', 15, 2).defaultTo(0)
      table.decimal('avg_cpc', 15, 2).nullable()
      table.decimal('avg_cpm', 15, 2).defaultTo(0)
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())

      table.unique(['ad_id', 'date'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}