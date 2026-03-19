import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

/**
 * Валидатор для установки даты начала синхронизации.
 * Правила:
 * - Формат ISO (YYYY-MM-DD)
 * - Не старше 3 лет от сегодня
 * - Не сегодня и не в будущем
 */
export const syncStartDateValidator = vine.compile(
  vine.object({
    sync_start_date: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .use(
        vine.createRule(async (value, _, field) => {
          if (typeof value !== 'string') return
          const date = DateTime.fromISO(value)
          if (!date.isValid) {
            field.report(
              'Некорректный формат даты (ожидается ISO YYYY-MM-DD)',
              'invalidDate',
              field
            )
            return
          }

          const today = DateTime.now().startOf('day')
          const threeYearsAgo = today.minus({ years: 3 })

          if (date >= today) {
            field.report('Дата должна быть строго раньше сегодняшней', 'dateFutureOrToday', field)
          }
          if (date < threeYearsAgo) {
            field.report('Дата не может быть старше 3 лет', 'dateTooOld', field)
          }
        })()
      ),
  })
)

/**
 * Валидатор для конфигурации AmoCRM.
 * Правила:
 * - domain должен содержать точку (наличие TLD)
 * - client_id и client_secret длиной не менее 10 символов
 */
export const amocrmConfigValidator = vine.compile(
  vine.object({
    domain: vine.string().regex(/^.+\..+$/),
    client_id: vine.string().minLength(10),
    client_secret: vine.string().minLength(10),
  })
)

/**
 * Валидатор для универсальной установки токена.
 * Правила:
 * - source: yandex или amocrm
 * - token: минимум 10 символов
 */
export const installTokenValidator = vine.compile(
  vine.object({
    source: vine.enum(['yandex', 'amocrm'] as const),
    token: vine.string().minLength(10),
  })
)
