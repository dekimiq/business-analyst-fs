import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

/**
 * Валидация настроек Yandex: токен и дата начала синхронизации.
 *
 * Правила для sync_start_date:
 *  - Формат ISO: YYYY-MM-DD
 *  - Не старше 3 лет от сегодняшней даты
 *  - Не позже сегодняшней даты
 */
export const setupYandexSettingsValidator = vine.compile(
  vine.object({
    token: vine.string().minLength(10),
    sync_start_date: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .use(
        vine.createRule(async (value, _, field) => {
          if (typeof value !== 'string') return
          const date = DateTime.fromISO(value)
          if (!date.isValid) {
            field.report('Некорректная дата', 'invalidDate', field)
            return
          }
          const today = DateTime.now().startOf('day')
          const threeYearsAgo = today.minus({ years: 3 })
          if (date > today) {
            field.report('Дата не может быть в будущем', 'dateFuture', field)
          }
          if (date < threeYearsAgo) {
            field.report('Дата не может быть старше 3 лет', 'dateTooOld', field)
          }
        })()
      ),
  })
)

export const updateYandexTokenValidator = vine.compile(
  vine.object({
    token: vine.string().minLength(10),
  })
)
