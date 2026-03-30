import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Инициализация источников данных при деплое (Data Migration).
 */
export default class extends BaseSchema {
  protected tableName = 'integration_metadata'

  async up() {
    this.defer(async (db) => {
      const sources = [
        {
          source: 'yandex',
          credentials: JSON.stringify({ long_token: null }),
        },
        {
          source: 'amocrm',
          credentials: JSON.stringify({
            domain: null,
            client_id: null,
            client_secret: null,
            long_token: null,
          }),
        },
      ]

      for (const item of sources) {
        const exists = await db.from(this.tableName).where('source', item.source).first()

        if (!exists) {
          await db.table(this.tableName).insert({
            source: item.source,
            credentials: item.credentials,
            created_at: new Date(),
            updated_at: new Date(),
          })
          console.log(`[DATA MIGRATION]: Источник ${item.source} успешно инициализирован.`)
        }
      }
    })
  }

  async down() {}
}
