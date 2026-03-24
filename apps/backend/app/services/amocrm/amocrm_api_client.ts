import fs from 'node:fs/promises'
import path from 'node:path'
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

  // ---------------------------------------------------------------------------
  // Logging (Debug)
  // ---------------------------------------------------------------------------

  private async logApiInteraction(
    method: string,
    url: string,
    params?: any,
    responseData?: any,
    error?: any
  ) {
    try {
      const debugDir = path.join(process.cwd(), '..', '..', 'debug')
      await fs.mkdir(debugDir, { recursive: true })

      const logPath = path.join(debugDir, 'amocrm_api_debug.json')
      const entry =
        JSON.stringify({
          timestamp: new Date().toISOString(),
          method,
          url,
          params: params || null,
          response: responseData || null,
          error: error
            ? {
                message: error.message,
                status: error.response?.status || error.response?.statusCode,
                data: error.response?.data,
              }
            : null,
        }) + '\n'

      await fs.appendFile(logPath, entry, 'utf-8')
    } catch (err) {
      console.error('[AmocrmApiClient] Error writing debug log:', err)
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.request.make('GET', '/api/v4/account')
      await this.logApiInteraction('GET', '/api/v4/account', null, res.data)
      return true
    } catch (error) {
      await this.logApiInteraction('GET', '/api/v4/account', null, null, error)
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
      response = await this.client.request.make('GET', '/api/v4/leads', params)
      await this.logApiInteraction('GET', '/api/v4/leads', params, response.data)
    } catch (error) {
      await this.logApiInteraction('GET', '/api/v4/leads', params, null, error)
      throw error
    }

    const statusCode =
      response.response?.status || response.response?.statusCode || response.data?.status
    if (statusCode && statusCode >= 400) {
      const error: any = new Error(
        response.data?.detail || response.data?.title || 'AmoCRM API Error'
      )
      error.response = { status: statusCode, data: response.data }
      throw error
    }

    const data = response.data as any
    const leads = data._embedded?.leads || []
    const hasNext = !!data._links?.next

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

          // Извлекаем параметры из URL (или просто используем page+1)
          // В документации AmoCRM лучше всего просто инкрементировать page
          const url = new URL(nextUrl)
          const nextParams = Object.fromEntries(url.searchParams.entries())

          let nextRes: any
          try {
            nextRes = await this.client.request.make('GET', '/api/v4/leads', nextParams)
            await this.logApiInteraction('GET', '/api/v4/leads', nextParams, nextRes.data)
          } catch (error) {
            await this.logApiInteraction('GET', '/api/v4/leads', nextParams, null, error)
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
      const response = await this.client.request.make('GET', `/api/v4/leads/${id}`)
      await this.logApiInteraction('GET', `/api/v4/leads/${id}`, null, response.data)
      return (response.data as AmoLead) || null
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } }
      await this.logApiInteraction('GET', `/api/v4/leads/${id}`, null, null, error)
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
