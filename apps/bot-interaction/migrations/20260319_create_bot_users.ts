import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('bot').dropTableIfExists('users')

  await knex.schema.withSchema('bot').createTable('users', (table) => {
    table.increments('id').primary()
    table.string('user_id').notNullable().unique()
    table.string('username').nullable()
    table.string('first_name').nullable()
    table.string('last_name').nullable()
    table.enum('role', ['dev', 'admin', 'user']).notNullable().defaultTo('user')
    table.boolean('is_active').notNullable().defaultTo(true)
    table.timestamps(true, true)
  })

  await knex.schema.withSchema('bot').table('users', (table) => {
    table.index(['role', 'is_active'], 'idx_users_role_active')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('bot').dropTableIfExists('users')
}
