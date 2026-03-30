import type { Knex } from 'knex'
import { env } from '@project/env'

/**
 * Инициализация первого разработчика (администратора) системы.
 */
export async function up(knex: Knex): Promise<void> {
  const schema = 'bot'

  const devUserId = env.USER_ID_DEV || '123456789'
  const devUsername = env.USERNAME_DEV || 'test'

  await knex.schema.withSchema(schema).raw(`
    INSERT INTO bot.users (user_id, username, role) 
    VALUES ('${devUserId}', '${devUsername}', 'dev') 
    ON CONFLICT (user_id) DO NOTHING;
  `)
}

export async function down(knex: Knex): Promise<void> {}
