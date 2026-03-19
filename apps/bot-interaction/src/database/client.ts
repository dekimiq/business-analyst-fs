import type { Knex } from 'knex'
import { createDatabase } from '../config/database.js'

// Синглтон-экземпляр Knex для bot-interaction
let instance: Knex | null = null

export function getDb(): Knex {
  if (!instance) {
    instance = createDatabase()
  }
  return instance
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy()
    instance = null
  }
}
