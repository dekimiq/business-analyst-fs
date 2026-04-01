import axios from 'axios'
import { env } from '@project/env'
import { logger } from '../utils/logger.js'

export class AiService {
  /**
   * Запрос генерации недельного отчета ROMI
   */
  async generateWeeklyReport(): Promise<string> {
    try {
      const aiModuleUrl = env.AI_MODULE_URL || 'http://localhost:3334'

      logger.info('Запрос генерации отчета в AI Module', { url: aiModuleUrl })

      const { data } = await axios.post(
        `${aiModuleUrl}/reports/weekly`,
        {},
        {
          timeout: 120000, // Ждем до 2 минут, генерация отчета ИИ - процесс не быстрый
        },
      )

      if (!data || !data.report) {
        throw new Error('AI Module вернул пустой отчет')
      }

      return data.report
    } catch (error: any) {
      logger.error('Ошибка при генерации отчета в AI Module', {
        message: error.message,
        response: error.response?.data,
      })
      throw new Error('Не удалось сгенерировать отчет. Попробуйте позже.')
    }
  }
}

export const aiService = new AiService()
