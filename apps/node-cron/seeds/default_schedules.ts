import type { Knex } from 'knex'

export async function seed(knex: Knex): Promise<void> {
  const schema = 'settings'

  await knex.schema.withSchema(schema).raw(`
    INSERT INTO settings.schedules (name, time_hh_mm, day_of_week) VALUES
    ('sync:crm', '*/5', NULL),
    ('sync:ads', '03:00', NULL),
    ('daily_report', '09:00', NULL),
    ('weekly_report', '10:00', 7),
    ('logs:cleanup', '04:00', 0)
    ON CONFLICT (name) DO NOTHING;
  `)
}
