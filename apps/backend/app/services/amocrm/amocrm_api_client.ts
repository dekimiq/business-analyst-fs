import { Client } from 'amocrm-js'
import type { IAmocrmApiClient, AmoLeadPage, AmoLeadFilter } from '#contracts/i_amocrm_api_client'
import type { AmoLead } from '#types/amocrm'

export interface AmocrmConfig {
  domain: string
  client_id: string
  client_secret: string
}

export class AmocrmApiClient implements IAmocrmApiClient {
  private readonly client: InstanceType<typeof Client>

  /**
   * Создаёт клиент для AmoCRM API.
   *
   * @param token - долгосрочный токен доступа (bearer token)
   * @param config - конфигурация (domain, client_id, client_secret, redirect_uri)
   */
  constructor(token: string, config?: Partial<AmocrmConfig>) {
    const domain = config?.domain
    const clientId = config?.client_id
    const clientSecret = config?.client_secret

    if (!domain) {
      throw new Error('ОШИБКА КОНФИГУРАЦИИ: AMOCRM_DOMAIN не задан в переменных окружения')
    }
    if (!clientId) {
      throw new Error('ОШИБКА КОНФИГУРАЦИИ: AMOCRM_CLIENT_ID не задан в переменных окружения')
    }
    if (!clientSecret) {
      throw new Error('ОШИБКА КОНФИГУРАЦИИ: AMOCRM_CLIENT_SECRET не задан в переменных окружения')
    }

    this.client = new Client({
      domain,
      auth: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: '',
        bearer: token,
      },
    })
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.request.make('GET', '/api/v4/account')
      return true
    } catch {
      return false
    }
  }

  /**
   * Получить сделки с пагинацией.
   *
   * @param filter - фильтр по датам (updated_at)
   * @param limit - количество записей на страницу (макс 250, рекомендуется 100)
   */
  async getLeads(filter?: AmoLeadFilter, limit = 250): Promise<AmoLeadPage> {
    const params: Record<string, unknown> = {
      limit,
      page: 1,
      with: 'contacts,companies',
    }

    if (filter?.updatedAt) {
      if (filter.updatedAt.from) params['filter[updated_at][from]'] = filter.updatedAt.from
      if (filter.updatedAt.to) params['filter[updated_at][to]'] = filter.updatedAt.to
    }

    const response: any = await this.client.request.make('GET', '/api/v4/leads', params)

    const statusCode =
      response.response?.status || response.response?.statusCode || response.data?.status
    if (statusCode && statusCode >= 400) {
      const error: any = new Error(
        response.data?.detail || response.data?.title || 'AmoCRM API Error'
      )
      error.response = { status: statusCode, data: response.data }
      throw error
    }

    const data = response.data as {
      _embedded?: {
        leads?: AmoLead[]
      }
      _page?: number
      _page_count?: number
    }

    const leads = data._embedded?.leads || []
    const currentPage = data._page || 1
    const pageCount = data._page_count || 1
    const hasNext = currentPage < pageCount

    return {
      data: leads,
      hasNext,
      next: async (): Promise<AmoLeadPage> => {
        if (!hasNext) {
          const emptyPage: AmoLeadPage = {
            data: [],
            hasNext: false,
            next: async () => emptyPage,
          }
          return emptyPage
        }

        const nextParams = { ...params, page: currentPage + 1 }
        const nextResponse = await this.client.request.make('GET', '/api/v4/leads', nextParams)
        const nextData = nextResponse.data as {
          _embedded?: {
            leads?: AmoLead[]
          }
          _page?: number
          _page_count?: number
        }

        const nextLeads = nextData._embedded?.leads || []
        const nextCurrentPage = nextData._page || currentPage + 1
        const nextPageCount = nextData._page_count || pageCount

        return {
          data: nextLeads,
          hasNext: nextCurrentPage < nextPageCount,
          next: async () => {
            throw new Error('next() already called - implement proper chaining if needed')
          },
        }
      },
    }
  }

  async getLeadById(id: number): Promise<AmoLead | null> {
    try {
      const response = await this.client.request.make('GET', `/api/v4/leads/${id}`)
      return (response.data as AmoLead) || null
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } }
      if (err.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  async getAllLeads(filter?: AmoLeadFilter): Promise<AmoLead[]> {
    const allLeads: AmoLead[] = []
    let page = await this.getLeads(filter)

    while (true) {
      allLeads.push(...page.data)

      if (!page.hasNext) {
        break
      }

      page = await page.next()
    }

    return allLeads
  }
}

export function createAmocrmClient(token: string): AmocrmApiClient {
  return new AmocrmApiClient(token)
}
