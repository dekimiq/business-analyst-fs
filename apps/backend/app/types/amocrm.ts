export interface AmoLead {
  id: number
  name: string
  price: number

  status_id: number
  pipeline_id: number

  created_by: number
  updated_by: number

  created_at: number
  updated_at: number
  closed_at: number | null
  closest_task_at: number | null

  custom_fields_values?: AmoCustomField[]

  _embedded?: {
    tags?: AmoTag[]
    contacts?: { id: number }[]
    companies?: { id: number }[]
  }
}

export interface AmoCustomField {
  field_id: number
  field_name: string
  field_code?: string | null
  field_type: string
  values: {
    value: string | number
  }[]
}

export interface AmoTag {
  id: number
  name: string
}

export interface AmoEvent {
  id: number
  type: string
  entity_id: number
  entity_type: string
  created_at: number
  account_id: number
  _embedded?: {
    entity?: any
  }
}

export interface AmoPipeline {
  id: number
  name: string
  sort: number
  is_main: boolean
  is_archive: boolean
  _embedded?: {
    statuses: AmoStatus[]
  }
}

export interface AmoStatus {
  id: number
  name: string
  sort: number
  is_editable: boolean
  pipeline_id: number
  color: string
  type: number
}
