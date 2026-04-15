import { Client } from 'amocrm-js'
import type { IAmocrmApiClient, AmoLeadPage, AmoLeadFilter } from '#contracts/i_amocrm_api_client'
import type { AmoLead, AmoEvent, AmoPipeline } from '#types/amocrm'
import { AmocrmRetryService } from '#utils/amocrm_retry'

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
      await AmocrmRetryService.call(() => this.client.request.make('GET', '/api/v4/account'))
      return true
    } catch (error) {
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

    let response: any
    try {
      response = await AmocrmRetryService.call(() =>
        this.client.request.make('GET', '/api/v4/leads', params)
      )
      this.checkStatus(response)
    } catch (error) {
      throw error
    }

    const data = response.data as any
    const leads = data._embedded?.leads || []

    const createPage = (leadsData: AmoLead[], nextData: any): AmoLeadPage => {
      const currentLeads = leadsData || []
      const hasMore = !!nextData?._links?.next
      const nextUrl = nextData?._links?.next?.href

      return {
        data: currentLeads,
        hasNext: hasMore,
        next: async (): Promise<AmoLeadPage> => {
          if (!hasMore || !nextUrl) {
            const emptyPage: AmoLeadPage = {
              data: [],
              hasNext: false,
              next: async () => emptyPage,
            }
            return emptyPage
          }

          const url = new URL(nextUrl)
          const nextParams = Object.fromEntries(url.searchParams.entries())

          let nextRes: any
          try {
            nextRes = await AmocrmRetryService.call(() =>
              this.client.request.make('GET', '/api/v4/leads', nextParams)
            )
          } catch (error) {
            throw error
          }

          return createPage(nextRes.data?._embedded?.leads || [], nextRes.data)
        },
      }
    }

    return createPage(leads, data)
  }

  async getLeadById(id: number): Promise<AmoLead | null> {
    try {
      const response = await AmocrmRetryService.call(() =>
        this.client.request.make('GET', `/api/v4/leads/${id}`)
      )
      return (response.data as AmoLead) || null
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } }
      if (err.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  async eachEvent(
    createdAtFrom: number,
    callback: (events: AmoEvent[]) => Promise<void>
  ): Promise<void> {
    const params = {
      'filter[created_at][from]': createdAtFrom,
      'limit': 100,
    }

    let currentParams: any = params

    while (true) {
      let response: any
      try {
        response = await AmocrmRetryService.call(() =>
          this.client.request.make('GET', '/api/v4/events', currentParams)
        )
        this.checkStatus(response)
      } catch (error: any) {
        if (error.response?.status === 204) {
          break
        }
        throw error
      }

      const data = response.data as any
      const events = data._embedded?.events || []

      if (events.length > 0) {
        await callback(events)
      }

      if (!data._links?.next) {
        break
      }

      const url = new URL(data._links.next.href)
      currentParams = Object.fromEntries(url.searchParams.entries())
    }
  }

  private checkStatus(response: any) {
    const statusCode =
      response.response?.status || response.response?.statusCode || response.data?.status
    if (statusCode && statusCode >= 400) {
      const errorTitle = response.data?.title || 'AmoCRM API Error'
      const errorDetail = response.data?.detail || ''
      const errorMsg = `${errorTitle}: ${errorDetail}`.trim()

      const error: any = new Error(errorMsg)
      error.response = { status: statusCode, data: response.data }
      throw error
    }
  }

  async eachLead(
    filter: AmoLeadFilter,
    callback: (leads: AmoLead[]) => Promise<void>,
    limit = 250
  ): Promise<void> {
    const params: Record<string, unknown> = {
      'limit': limit,
      'page': 1,
      'with': 'contacts,companies',
      'order[updated_at]': 'asc',
    }

    if (filter.updatedAt) {
      if (filter.updatedAt.from) params['filter[updated_at][from]'] = filter.updatedAt.from
      if (filter.updatedAt.to) params['filter[updated_at][to]'] = filter.updatedAt.to
    }

    let currentParams: any = params

    while (true) {
      let response: any
      try {
        response = await AmocrmRetryService.call(() =>
          this.client.request.make('GET', '/api/v4/leads', currentParams)
        )
        this.checkStatus(response)
      } catch (error: any) {
        if (error.response?.status === 204) {
          break
        }
        throw error
      }

      const data = response.data as any
      const leads = data._embedded?.leads || []

      if (leads.length > 0) {
        await callback(leads)
      }

      if (!data._links?.next) {
        break
      }

      const url = new URL(data._links.next.href)
      currentParams = Object.fromEntries(url.searchParams.entries())
    }
  }

  async getLeadsByIds(ids: number[]): Promise<AmoLead[]> {
    if (ids.length === 0) return []

    const chunkSize = 50
    const allLeads: AmoLead[] = []

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const params: any = {
        'filter[id]': chunk,
        'with': 'contacts,companies',
      }

      try {
        const response = await AmocrmRetryService.call(() =>
          this.client.request.make('GET', '/api/v4/leads', params)
        )
        const data = response.data as any
        const leads = data._embedded?.leads || []
        allLeads.push(...leads)
      } catch (error: any) {
        if (error.response?.status === 204) {
          continue
        }
        throw error
      }
    }

    return allLeads
  }

  async getAllLeads(filter?: AmoLeadFilter): Promise<AmoLead[]> {
    const allLeads: AmoLead[] = []
    await this.eachLead(filter || {}, async (leads) => {
      allLeads.push(...leads)
    })
    return allLeads
  }

  async getPipelines(): Promise<AmoPipeline[]> {
    try {
      const response = await AmocrmRetryService.call(() =>
        this.client.request.make('GET', '/api/v4/leads/pipelines')
      )
      const data = response.data as any
      return data._embedded?.pipelines || []
    } catch (error) {
      throw error
    }
  }
}

export function createAmocrmClient(token: string): AmocrmApiClient {
  return new AmocrmApiClient(token)
}
