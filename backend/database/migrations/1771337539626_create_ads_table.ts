import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ads'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.bigInteger('campaign_id').index()
      table.bigInteger('group_id').index()
      table.bigInteger('ad_id').index()
      table.string('source').index()

      table.string('campaign_name')
      table.string('group_name')
      table.string('condition_name')
      table.bigInteger('condition_id')
      table.string('ad_platform')
      table.string('title')
      table.string('text')
      table.bigInteger('impressions').defaultTo(0)
      table.bigInteger('clicks').defaultTo(0)
      table.decimal('ctr', 5, 2).defaultTo(0)
      table.decimal('cost', 15, 2).defaultTo(0)
      table.decimal('avg_cpc', 15, 2).nullable()
      table.decimal('avg_cpm', 15, 2).defaultTo(0)

      table.timestamp('created_at')
      table.timestamp('r')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}