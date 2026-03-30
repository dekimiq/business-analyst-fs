import type { Knex } from 'knex'

/**
 * Инициализация расписаний при деплое (Data Migration).
 * Гарантирует, что система готова к работе без явного запуска сидов.
 */
export async function up(knex: Knex): Promise<void> {
  const schema = 'settings'

  await knex.schema.withSchema(schema).raw(`
    INSERT INTO settings.schedules (name, time_hh_mm, day_of_week) VALUES
    ('sync:crm:light', '*/30', NULL),
    ('sync:crm:heavy', '03:20', NULL),
    ('sync:ads', '03:00', NULL),
    ('report:daily', '09:00', NULL),
    ('report:weekly', '10:00', 7)
    ON CONFLICT (name) DO UPDATE SET 
      time_hh_mm = EXCLUDED.time_hh_mm, 
      day_of_week = EXCLUDED.day_of_week;
  `)
}

export async function down(knex: Knex): Promise<void> {
  // В down-миграции не удаляем данные, чтобы не прерывать работу при откатах схем
}
