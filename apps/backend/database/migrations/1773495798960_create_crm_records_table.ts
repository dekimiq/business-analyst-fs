import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'crm_records'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('deal_id', 50).nullable().unique().index()

      table.bigInteger('campaign_id').nullable().index()
      table.bigInteger('group_id').nullable().index()
      table.bigInteger('ad_id').nullable().index()
      table.string('source').nullable().index()
      table.string('deal_stage').nullable().index()

      table.string('deal_name').nullable()
      table.string('company_name').nullable()
      table.string('sale_funnel').nullable()
      table.decimal('budget', 15, 2).defaultTo(0)
      table.timestamp('record_created_at').nullable().comment('Дата создания заявки')
      table.timestamp('record_updated_at').nullable().comment('Дата обновления заявки')
      table.string('record_created_by_name').nullable().comment('Кем создана заявка')
      table.string('record_updated_by_name').nullable().comment('Кем обновлена заявка')
      table.string('tag_deal').nullable()
      table.timestamp('record_next_task_at').nullable()
      table.timestamp('record_closed_task_at').nullable()
      table.string('region').nullable()
      table.string('city').nullable()
      table.string('comment').nullable()
      table.decimal('price', 15, 2).defaultTo(0)
      table.string('product').nullable()
      table.string('referrer').nullable()
      table.string('website').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
