import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'crm_records'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('deal_id', 50).nullable().unique().index()

      // Суррогатные ключи (PKs для JOIN)
      table.integer('campaign_pk').nullable().index()
      table.integer('group_pk').nullable().index()
      table.integer('ad_pk').nullable().index()

      // Натуральные ID (Text IDs из меток)
      table.text('campaign_id').nullable().index()
      table.text('group_id').nullable().index()
      table.text('ad_id').nullable().index()

      table.string('source').nullable().index()
      table.string('deal_stage').nullable().index()

      table.text('deal_name').nullable()
      table.text('company_name').nullable()
      table.string('sale_funnel').nullable()
      table.decimal('budget', 15, 2).defaultTo(0)
      table.timestamp('record_created_at').nullable().comment('Дата создания заявки')
      table.timestamp('record_updated_at').nullable().comment('Дата обновления заявки')
      table.text('record_created_by_name').nullable().comment('Кем создана заявка')
      table.text('record_updated_by_name').nullable().comment('Кем обновлена заявка')
      table.text('tag_deal').nullable()
      table.timestamp('record_next_task_at').nullable()
      table.timestamp('record_closed_task_at').nullable()
      table.text('region').nullable()
      table.text('city').nullable()
      table.text('comment').nullable()
      table.decimal('price', 15, 2).defaultTo(0)
      table.text('product').nullable()
      table.text('referrer').nullable()
      table.text('website').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
