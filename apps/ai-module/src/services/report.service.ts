import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { env } from '@project/env'
import { fileURLToPath } from 'url'
import { LlmService } from './llm.service.js'
import { toKvMarkdown } from '../utils/kv_transformer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * ReportService
 * Оркестратор: Склеивает данные от Бэкенда и LLM.
 */
export class ReportService {
  private static instance: ReportService

  private constructor() {}

  public static getInstance(): ReportService {
    if (!ReportService.instance) {
      ReportService.instance = new ReportService()
    }
    return ReportService.instance
  }

  /**
   * Генерация недельного отчета
   */
  public async generateWeeklyReport(): Promise<string> {
    const instructionPath = path.resolve(__dirname, '../../instructions/weekly_report.md')
    const instruction = await fs.readFile(instructionPath, 'utf-8')

    try {
      const { data: response } = await axios.get(`${env.BACKEND_API_URL}/analytics/weekly-romi`)

      let finalMarkdown = ''
      if (response.status === 'error') {
        finalMarkdown = `### SYSTEM NOTICE\nBackend reports an error: ${response.message}\n\n### APPLIED FILTERS\n${toKvMarkdown(response.meta || {})}`
      } else {
        const metaMarkdown = response.meta
          ? `### APPLIED FILTERS\n${toKvMarkdown(response.meta)}\n\n`
          : ''
        const statsMarkdown = `### ANALYSIS DATA\n${toKvMarkdown(response.data || response)}`
        finalMarkdown = `${metaMarkdown}${statsMarkdown}`
      }

      const aiReport = await LlmService.getInstance().analyze(instruction, finalMarkdown)
      return aiReport
    } catch (error: any) {
      const url = `${env.BACKEND_API_URL}/analytics/weekly-romi`
      console.error(
        `[ReportService] Ошибка при генерации еженедельного отчета (URL: ${url}): ${error.message}`,
      )
      throw new Error(`Не удалось получить данные отчета: ${error.message}`)
    }
  }
}
