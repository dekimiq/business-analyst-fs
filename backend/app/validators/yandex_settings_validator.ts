import vine from '@vinejs/vine'

/**
 * POST /api/yandex/settings/sync-date
 *
 * Принимает либо флаг `default: true` (= today - 3 months),
 * либо конкретную дату в ISO-формате `YYYY-MM-DD`.
 */
export const syncDateValidator = vine.compile(
  vine.object({
    useDefault: vine.boolean().optional(),
    date: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
)

/**
 * POST /api/yandex/settings/token
 *
 * OAuth 2.0 токен Яндекс.Директ.
 */
export const tokenValidator = vine.compile(
  vine.object({
    token: vine.string().trim().minLength(10),
  })
)
