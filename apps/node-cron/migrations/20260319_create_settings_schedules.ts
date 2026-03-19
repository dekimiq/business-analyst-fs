import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  const schema = 'settings'

  await knex.schema.withSchema(schema).createTable('schedules', (table) => {
    table.string('name', 50).primary()
    table.string('time_hh_mm', 5).notNullable()
    table.integer('day_of_week').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  const schema = 'settings'
  await knex.schema.withSchema(schema).dropTableIfExists('schedules')
}
