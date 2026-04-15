/**
 * KV Transformer
 * Преобразует JSON (объекты или массивы) в KV Markdown:
 * **Key**: Value
 */

export function toKvMarkdown(data: any, prefix = ''): string {
  if (data === null || data === undefined) return 'null'

  if (Array.isArray(data)) {
    return data
      .map((item, index) => {
        const itemStr = toKvMarkdown(item, prefix)
        return `### Entry ${index + 1}\n${itemStr}`
      })
      .join('\n\n')
  }

  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([key, value]) => {
        const formattedKey = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase())
          .trim()

        if (typeof value === 'object' && value !== null) {
          return `\n#### ${formattedKey}\n${toKvMarkdown(value, prefix + '  ')}`
        }

        return `**${formattedKey}**: ${value}`
      })
      .filter(Boolean)
      .join('\n')
  }

  return String(data)
}
