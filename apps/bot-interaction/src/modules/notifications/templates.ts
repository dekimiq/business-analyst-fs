/**
 * Шаблоны сообщений для уведомлений
 */
export const templates = {
  /**
   * Шаблон для ошибок
   */
  error: (data: { service: string; module: string; message: string }): string => {
    return [
      '🚨 <b>Произошла ошибка</b>',
      '',
      `<b>Сервис:</b> <code>${data.service}</code>`,
      `<b>Модуль:</b> <code>${data.module}</code>`,
      '',
      '<b>Текст ошибки:</b>',
      `<pre>${data.message}</pre>`,
    ].join('\n')
  },

  /**
   * Шаблон для успешных операций (опционально)
   */
  success: (data: { service: string; module: string; message: string }): string => {
    return [
      '✅ <b>Успешно выполнено</b>',
      '',
      `<b>Сервис:</b> <code>${data.service}</code>`,
      `<b>Модуль:</b> <code>${data.module}</code>`,
      '',
      data.message,
    ].join('\n')
  },
}
