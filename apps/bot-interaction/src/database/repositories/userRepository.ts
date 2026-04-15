import type { Knex } from 'knex'
import { getDb } from '../client.js'
import type { UserRole, UserRow } from '../types.js'

const NOTIFICATION_ROLES: UserRole[] = ['dev']

export class UserRepository {
  private get db(): Knex {
    return getDb()
  }

  async findByUserId(userId: string): Promise<UserRow | undefined> {
    return this.db<UserRow>('bot.users').where({ user_id: userId }).first()
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    return this.db<UserRow>('bot.users').where({ username }).first()
  }

  async update(id: number, data: Partial<UserRow>): Promise<void> {
    await this.db<UserRow>('bot.users')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
  }

  async findNotificationRecipients(): Promise<UserRow[]> {
    return this.db<UserRow>('bot.users')
      .whereIn('role', NOTIFICATION_ROLES)
      .where({ is_active: true })
  }

  async upsert(
    data: Pick<UserRow, 'user_id' | 'username' | 'first_name' | 'last_name'>,
  ): Promise<UserRow> {
    const [user] = await this.db<UserRow>('bot.users')
      .insert({
        ...data,
        role: 'user',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict('user_id')
      .merge({
        username: data.username,
        first_name: data.first_name,
        last_name: data.last_name,
        updated_at: new Date(),
      })
      .returning('*')

    return user
  }

  async updateRole(userId: string, role: UserRole): Promise<void> {
    await this.db<UserRow>('bot.users')
      .where({ user_id: userId })
      .update({ role, updated_at: new Date() })
  }
}
