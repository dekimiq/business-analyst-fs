import type { AmoLead } from '../types/amocrm.ts'
import { DateTime } from 'luxon'

export interface AmoLeadFilter {
  /**
   * Фильтр по дате обновления (updated_at).
   * AmoCRM API v4 поддерживает только FROM -> TO диапазон.
   */
  updatedAt?: {
    from?: number // timestamp
    to?: number // timestamp
  }
}

export interface AmoLeadPage {
  data: AmoLead[]
  hasNext: boolean
  next(): Promise<AmoLeadPage>
}

export interface IAmocrmApiClient {
  /**
   * Проверка доступности API (ping).
   */
  ping(): Promise<boolean>

  /**
   * Получить сделки с пагинацией.
   * @param filter - фильтры для запроса (период дат)
   * @param limit - количество записей на страницу (макс 250)
   */
  getLeads(filter?: AmoLeadFilter, limit?: number): Promise<AmoLeadPage>

  /**
   * Получить сделку по ID.
   */
  getLeadById(id: number): Promise<AmoLead | null>

  /**
   * Получить список всех сделок (итератор по всем страницам).
   * Используется для первичной загрузки всех сделок.
   */
  getAllLeads(filter?: AmoLeadFilter): Promise<AmoLead[]>
}
