import telegramify from 'telegramify-markdown'

/**
 * TelegramFormatter
 * Утилита для очистки, форматирования и нарезки сообщений для Telegram.
 */
export class TelegramFormatter {
  /**
   * 1. Очистка (Sanitization) - Твоя логика из n8n
   */
  public static sanitize(text: string): string {
    if (!text) return ''

    return (
      text
        // Заменяем <br> и <br/> на переносы строк
        .replace(/<br\s*\/?>/gi, '\n')
        // Удаляем теги <thinking> и всё их содержимое
        .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
        // Удаляем незакрытые теги <thinking> (если остались)
        .replace(/<thinking[^>]*>/gi, '')
        // Удаляем закрывающие теги </thinking> без открывающих (если остались)
        .replace(/<\/thinking>/gi, '')
        // Деэкранируем \n (если они пришли как строка "\\n")
        .replace(/\\n/g, '\n')
        // Удаляем множественные переносы строк (3 и более -> 2)
        .replace(/\n{3,}/g, '\n\n')
        // Убираем пробелы в начале и конце
        .trim()
    )
  }

  /**
   * 2. Форматирование в MarkdownV2 через либу
   */
  public static toMarkdownV2(text: string): string {
    const sanitized = this.sanitize(text)
    // Библиотека экранирует спецсимволы . _ * [ ] и т.д.
    return telegramify(sanitized, 'escape')
  }

  /**
   * 3. Нарезка на части (Chunking)
   */
  public static split(text: string, limit = 4000): string[] {
    const chunks: string[] = []
    let currentText = text

    while (currentText.length > 0) {
      if (currentText.length <= limit) {
        chunks.push(currentText)
        break
      }

      // Пытаемся найти ближайший перенос строки, чтобы не резать посередине предложения
      let splitPos = currentText.lastIndexOf('\n', limit)

      // Если переносов нет (одна длинная строка), режем по пробелу
      if (splitPos <= 0) {
        splitPos = currentText.lastIndexOf(' ', limit)
      }

      // Если и пробелов нет, режем просто по лимиту
      if (splitPos <= 0) {
        splitPos = limit
      }

      chunks.push(currentText.slice(0, splitPos).trim())
      currentText = currentText.slice(splitPos).trimStart()
    }

    return chunks
  }

  /**
   * Полный цикл подготовки к отправке
   */
  public static prepare(text: string): string[] {
    const mdV2 = this.toMarkdownV2(text)
    return this.split(mdV2)
  }
}
