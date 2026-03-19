export type UserRole = 'dev' | 'admin' | 'user'

export interface UserRow {
  id: number
  user_id: string
  username: string | null
  first_name: string | null
  last_name: string | null
  role: UserRole
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface NotificationLogRow {
  id: number
  user_id: number
  message: string
  sent_at: Date
  status: 'sent' | 'failed'
  error_message: string | null
}
