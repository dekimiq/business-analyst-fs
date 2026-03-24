import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'daily_stats'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.integer('ad_pk').unsigned().references('id').inTable('ads').onDelete('CASCADE')
      table.date('date').notNullable()

      table.integer('impressions').notNullable().defaultTo(0)
      table.integer('clicks').notNullable().defaultTo(0)
      table.decimal('ctr', 10, 4).notNullable().defaultTo(0)
      table.decimal('cost', 12, 2).notNullable().defaultTo(0)
      table.decimal('avg_cpc', 12, 2).nullable()
      table.decimal('avg_cpm', 12, 2).notNullable().defaultTo(0)

      table.unique(['ad_pk', 'date'])

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
