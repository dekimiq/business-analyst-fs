import express from 'express'
import cors from 'cors'
import { env } from '@project/env'
import reportRoutes from './routes/reports.js'

const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Routes
// /reports/weekly - Еженедельный аналитический отчет
app.use('/reports', reportRoutes)

// Healthcheck (для статус-мониторинга)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

// Start Server
// Используем порт 3334 (backend на 3333, ии на 3334 - чтоб не конфликтовали)
const port = 3334

app.listen(port, '0.0.0.0', () => {
  console.log(`
  🤖 [AI Module] Сервис аналитики запущен:
  -----------------------------------------
  🚀 URL: http://0.0.0.0:${port}
  📍 Health: http://0.0.0.0:${port}/health
  📊 Reports: http://0.0.0.0:${port}/reports/weekly (POST)
  💡 Model: ${env.MODEL_NAME_AI}
  🔗 Provider: OpenRouter
  -----------------------------------------
  🛠️ Ожидаю запроса от Telegram бот-интерфейса...
  `)
})
