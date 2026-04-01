import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from '@project/env'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * LlmService
 * Общается с OpenRouter (Gemini / Claude / OpenAI).
 */
export class LlmService {
  private static instance: LlmService
  private openaiProvider: any

  private constructor() {
    this.openaiProvider = createOpenAI({
      baseURL: env.BASE_URL_AI,
      apiKey: env.TOKEN_AI,
    })
  }

  public static getInstance(): LlmService {
    if (!LlmService.instance) {
      LlmService.instance = new LlmService()
    }
    return LlmService.instance
  }

  /**
   * Генерация аналитического текста
   * @param instruction Дополнительная инструкция (.md файл)
   * @param data Данные в формате KV Markdown
   */
  public async analyze(instruction: string, data: string): Promise<string> {
    const model = this.openaiProvider(env.MODEL_NAME_AI)
    const systemPromptPath = path.resolve(__dirname, '../prompts/system_core.md')
    const systemCore = await fs.readFile(systemPromptPath, 'utf-8')

    const finalSystemPrompt = `
${systemCore}

### ИНСТРУКЦИЯ ДЛЯ ТЕКУЩЕЙ ЗАДАЧИ:
${instruction}
`.trim()

    const { text } = await generateText({
      model,
      system: finalSystemPrompt,
      prompt: `Проанализируй следующие данные:\n\n${data}`,
      temperature: 0.2, // Меньше креативности, больше точности в цифрах
    })

    return text
  }
}
