import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import CrmRecord from '#models/crm_record'
import Campaign from '#models/campaign'
import AdGroup from '#models/ad_group'
import Ad from '#models/ad'
import type { AmoLead } from '#types/amocrm'
import type { AmocrmSyncContext } from './amocrm_sync_context.js'

const MAX_BIGINT = BigInt('9223372036854775807')

/**
 * Сохраняет пакет сделок в базу данных.
 */
export async function saveLeadsToDb(ctx: AmocrmSyncContext, leads: AmoLead[]): Promise<void> {
  const { source } = ctx

  if (leads.length === 0) return

  const leadsParsed = leads.map((lead) => ({
    lead,
    ids: parseIdsFromLead(lead),
  }))

  const allDetectedIds = new Set<string>()
  leadsParsed.forEach((p) => p.ids.forEach((id) => allDetectedIds.add(id)))

  const lookup = await fetchAdEntitiesLookup(Array.from(allDetectedIds))

  await db.transaction(async (trx) => {
    for (const { lead, ids } of leadsParsed) {
      const createdAt = DateTime.fromSeconds(lead.created_at)
      const updatedAt = DateTime.fromSeconds(lead.updated_at)
      const closedAt = lead.closed_at ? DateTime.fromSeconds(lead.closed_at) : null

      const budget = lead.price || 0
      const adLinks = matchLeadWithAdEntities(ids, lookup)
      const fields = mapCustomFields(lead)

      await CrmRecord.updateOrCreate(
        { source, dealId: String(lead.id) },
        {
          campaignId: adLinks.campaignId,
          groupId: adLinks.groupId,
          adId: adLinks.adId,
          campaignPk: adLinks.campaignPk,
          groupPk: adLinks.groupPk,
          adPk: adLinks.adPk,

          source,
          referrer: adLinks.source || null,

          dealName: lead.name,
          dealStage: String(lead.status_id),
          saleFunnel: String(lead.pipeline_id),

          pipelineId: String(lead.pipeline_id),
          statusId: String(lead.status_id),

          budget,

          recordCreatedAt: createdAt,
          recordUpdatedAt: updatedAt,
          recordClosedTaskAt: closedAt,

          tagDeal: fields.tagDeal,
          region: fields.region,
          city: fields.city,
          product: fields.product,
          comment: fields.comment,
          website: fields.website,

          price: budget,
          rawIds: adLinks.rawIds.length > 0 ? adLinks.rawIds.join('|') : null,
          isDeleted: false,
        },
        { client: trx }
      )
    }
  })
}

/**
 * Извлекает числовые ID из UTM-полей (приоритет) и fallback на остальные.
 */
function parseIdsFromLead(lead: AmoLead): Set<string> {
  const utmIds = new Set<string>()
  const otherIds = new Set<string>()
  const idRegex = /\d{7,19}/g

  if (lead.custom_fields_values) {
    for (const field of lead.custom_fields_values) {
      const name = field.field_name?.toLowerCase() || ''
      const isUtm = name.includes('utm') || name.includes('label')

      for (const val of field.values) {
        if (!val.value) continue
        const matches = String(val.value).match(idRegex)
        if (matches) {
          matches.forEach((m) => (isUtm ? utmIds.add(m) : otherIds.add(m)))
        }
      }
    }
  }

  if (utmIds.size > 0) return finalizeIds(utmIds)

  if (lead.name) {
    const matches = lead.name.match(idRegex)
    if (matches) matches.forEach((m) => otherIds.add(m))
  }

  return finalizeIds(otherIds)
}

function finalizeIds(ids: Set<string>): Set<string> {
  const result = new Set<string>()
  for (const id of ids) {
    try {
      if (BigInt(id) <= MAX_BIGINT) result.add(id)
    } catch {
      /* ignore */
    }
  }
  return result
}

async function fetchAdEntitiesLookup(ids: string[]) {
  if (ids.length === 0) return { ads: [], groups: [], campaigns: [] }

  const [ads, groups, campaigns] = await Promise.all([
    Ad.query().whereIn('adId', ids).preload('adGroup'),
    AdGroup.query().whereIn('groupId', ids).preload('campaign'),
    Campaign.query().whereIn('campaignId', ids),
  ])

  return { ads, groups, campaigns }
}

function matchLeadWithAdEntities(ids: Set<string>, lookup: any) {
  const idArray = Array.from(ids)

  for (const id of idArray) {
    const ad = lookup.ads.find((a: any) => a.adId === id)
    if (ad) {
      const group = ad.adGroup
      const campaign = group ? lookup.campaigns.find((c: any) => c.id === group.campaignPk) : null
      return {
        campaignId: campaign?.campaignId || null,
        groupId: group?.groupId || null,
        adId: ad.adId,
        campaignPk: campaign?.id || null,
        groupPk: group?.id || null,
        adPk: ad.id,
        source: ad.source,
        rawIds: [],
      }
    }
  }

  for (const id of idArray) {
    const group = lookup.groups.find((g: any) => g.groupId === id)
    if (group) {
      return {
        campaignId: group.campaign?.campaignId || null,
        groupId: group.groupId,
        adId: null,
        campaignPk: group.campaign?.id || null,
        groupPk: group.id,
        adPk: null,
        source: group.source,
        rawIds: [],
      }
    }
  }

  for (const id of idArray) {
    const campaign = lookup.campaigns.find((c: any) => c.campaignId === id)
    if (campaign) {
      return {
        campaignId: campaign.campaignId,
        groupId: null,
        adId: null,
        campaignPk: campaign.id,
        groupPk: null,
        adPk: null,
        source: campaign.source,
        rawIds: [],
      }
    }
  }

  return {
    campaignId: null,
    groupId: null,
    adId: null,
    campaignPk: null,
    groupPk: null,
    adPk: null,
    source: null,
    rawIds: idArray,
  }
}

function mapCustomFields(lead: AmoLead) {
  const result = {
    tagDeal: null as string | null,
    region: null as string | null,
    city: null as string | null,
    product: null as string | null,
    comment: null as string | null,
    website: null as string | null,
  }

  if (!lead.custom_fields_values) return result

  for (const field of lead.custom_fields_values) {
    const name = field.field_name?.toLowerCase() || ''
    const val = String(field.values[0]?.value || '')
    if (!val) continue

    if (name.includes('тег')) result.tagDeal = val
    else if (name.includes('регион')) result.region = val
    else if (name.includes('город')) result.city = val
    else if (name.includes('продукт')) result.product = val
    else if (name.includes('комментар')) result.comment = val
    else if (name.includes('сайт') || name.includes('website')) result.website = val
  }

  return result
}
