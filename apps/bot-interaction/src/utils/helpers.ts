// Вспомогательные утилиты для бота

/**
 * Экранирует специальные символы MarkdownV2
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

/**
 * Форматирует дату в читаемый вид (Moscow time)
 */
export function formatDate(date: Date): string {
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}

/**
 * Задержка выполнения
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Безопасное приведение unknown к строке
 */
export function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
