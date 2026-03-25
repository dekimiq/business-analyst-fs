import vine, { SimpleMessagesProvider } from '@vinejs/vine'

/**
 * Валидатор для конфигурации AmoCRM.
 * Реализует требования по длине ID и секретов.
 */
export const amocrmConfigValidator = vine.compile(
  vine.object({
    domain: vine
      .string()
      .trim()
      // Базовая проверка на формат домена (наличие точки)
      .regex(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i),
    client_id: vine.string().trim().minLength(20),
    client_secret: vine.string().trim().minLength(40),
  })
)

/**
 * Кастомные сообщения об ошибках на русском языке.
 */
amocrmConfigValidator.messagesProvider = new SimpleMessagesProvider({
  'required': 'Поле {{ field }} обязательно для заполнения',
  'minLength': 'Поле {{ field }} слишком короткое (минимум {{ min }} символов)',
  'regex': 'Поле {{ field }} имеет неверный формат',
  'domain.regex': 'Укажите корректный домен (например, domain.amocrm.ru)',
  'client_id.minLength': 'Длина Client ID должна быть не менее 20 символов',
  'client_secret.minLength': 'Длина Client Secret должна быть не менее 40 символов',
})
