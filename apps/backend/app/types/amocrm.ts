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
