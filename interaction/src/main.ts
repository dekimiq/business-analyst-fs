import 'reflect-metadata'
import { Bot } from 'grammy'
import dotenv from 'dotenv'

dotenv.config()

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || '')

bot.command('start', (ctx) => ctx.reply('Hello from FinPlatform Interaction Service!'))

bot.on('message', (ctx) => ctx.reply('Got your message!'))

async function run() {
  console.log('Starting Interaction Service...')
  // Database connect logic here
  // Redis connect logic here

  await bot.start()
  console.log('Bot started!')
}

run().catch(console.error)
