import vine, { SimpleMessagesProvider } from '@vinejs/vine'

/**
 * Валидатор для установки токена (универсальный)
 */
export const installTokenValidator = vine.compile(
  vine.object({
    source: vine.enum(['yandex', 'amocrm'] as const),
    token: vine.string().trim().minLength(10),
  })
)

installTokenValidator.messagesProvider = new SimpleMessagesProvider({
  'required': 'Поле {{ field }} обязательно для заполнения',
  'source.enum': 'Недопустимый источник. Выберите "yandex" или "amocrm"',
  'token.minLength': 'Длина токена должна быть не менее 10 символов',
})
