import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import { DateTime } from 'luxon'

/**
 * Валидатор для установки даты начала синхронизации (глобально)
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
            field.report('Некорректный формат даты (ISO YYYY-MM-DD)', 'invalidDate', field)
            return
          }

          const today = DateTime.now().startOf('day')
          const threeYearsAgo = today.minus({ years: 3 })

          if (date >= today) {
            field.report('Дата должна быть строго в прошлом', 'dateFutureOrToday', field)
          }
          if (date < threeYearsAgo) {
            field.report('Дата не может быть старше 3 лет', 'dateTooOld', field)
          }
        })()
      ),
  })
)

syncStartDateValidator.messagesProvider = new SimpleMessagesProvider({
  required: 'Поле {{ field }} обязательно для заполнения',
  regex: 'Неверный формат даты. Ожидается YYYY-MM-DD',
})
