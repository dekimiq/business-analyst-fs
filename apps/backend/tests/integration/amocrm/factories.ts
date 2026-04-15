export function makeAmoCrmPipeline(id: number, name: string, statuses: any[]) {
  return {
    id,
    name,
    sort: 1,
    is_main: true,
    is_unsorted_on: true,
    is_archive: false,
    account_id: 31315702,
    _embedded: {
      statuses: statuses.map((s, idx) => ({
        id: s.id,
        name: s.name,
        sort: (idx + 1) * 10,
        is_editable: true,
        pipeline_id: id,
        color: '#99ccff',
        type: 0,
        account_id: 31315702,
      })),
    },
  }
}

export function toPipelinesResponse(pipelines: any[]) {
  return {
    _total_items: pipelines.length,
    _embedded: {
      pipelines,
    },
  }
}

export function makeAmoLead(id: number, overrides: Partial<any> = {}) {
  return {
    id,
    name: `Lead ${id}`,
    price: 0,
    responsible_user_id: 10133894,
    group_id: 0,
    status_id: 143,
    pipeline_id: 7288570,
    created_at: 1695737396,
    updated_at: 1695738298,
    is_deleted: false,
    custom_fields_values: [
      {
        field_id: 2588391,
        field_name: '_ym_uid',
        field_code: '_YM_UID',
        field_type: 'tracking_data',
        values: [{ value: '1695736012934348285' }],
      },
      // Добавим UTM для теста атрибуции позже, а пока базовый набор
    ],
    ...overrides,
  }
}

export function makeAmoEvent(id: string, type: string, entityId: number) {
  return {
    id,
    type,
    entity_id: entityId,
    entity_type: 'lead',
    created_at: Math.floor(Date.now() / 1000),

    created_by: 10133894,
    value_after: [],
    value_before: [],
  }
}

export function toEventsResponse(events: any[], hasNext = false) {
  if (events.length === 0) return null
  return {
    _page: 1,
    _links: {
      self: { href: '' },
      ...(hasNext ? { next: { href: 'https://ratelead.amocrm.ru/api/v4/events?page=2' } } : {}),
    },
    _embedded: {
      events,
    },
  }
}

export function toLeadsResponse(leads: any[]) {
  return {
    _embedded: {
      leads,
    },
  }
}
