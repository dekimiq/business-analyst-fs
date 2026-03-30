import type { Knex } from 'knex'

export async function seed(knex: Knex): Promise<void> {
  const schema = 'settings'

  await knex.schema.withSchema(schema).raw(`
    -- Удаляем старые/неактуальные задачи
    DELETE FROM settings.schedules WHERE name IN ('sync:crm', 'daily_report', 'weekly_report', 'logs:cleanup');

    INSERT INTO settings.schedules (name, time_hh_mm, day_of_week) VALUES
    ('sync:crm:light', '*/30', NULL),
    ('sync:crm:heavy', '03:20', NULL),
    ('sync:ads', '03:00', NULL),
    ('report:daily', '09:00', NULL),
    ('report:weekly', '10:00', 7)
    ON CONFLICT (name) DO UPDATE SET time_hh_mm = EXCLUDED.time_hh_mm, day_of_week = EXCLUDED.day_of_week;
  `)
}
