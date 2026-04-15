import type { Knex } from 'knex'

/**
 * Ослабляем ограничение на user_id, чтобы можно было добавлять пользователей по никнейму.
 */
export async function up(knex: Knex): Promise<void> {
  const schema = 'bot'
  const table = 'users'

  await knex.schema.withSchema(schema).alterTable(table, (t) => {
    // Делаем user_id nullable
    t.string('user_id').nullable().alter()

    // Добавляем уникальность для username, так как это теперь наша "зацепка"
    t.unique(['username'], { indexName: 'idx_users_username_unique' })
  })
}

export async function down(knex: Knex): Promise<void> {
  const schema = 'bot'
  const table = 'users'

  await knex.schema.withSchema(schema).alterTable(table, (t) => {
    t.string('user_id').notNullable().alter()
    t.dropUnique(['username'], 'idx_users_username_unique')
  })
}
