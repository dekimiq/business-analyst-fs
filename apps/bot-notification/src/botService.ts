import { Bot } from '@maxhub/max-bot-api'
import { env } from '@project/env'
import { sleep } from '@project/shared'

const bot = new Bot(env.MAX_BOT_TOKEN!)

export class BotService {
  /**
   * Sends a message to a specific user with 5 retries on failure (Exponential Backoff).
   *
   * @param userId telegram user id (chat_id)
   * @param text message text
   */
  static async sendAlertMessage(userId: string, text: string): Promise<void> {
    const MAX_RETRIES = 5

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await bot.api.sendMessageToUser(Number(userId), text)
        console.log(
          `[INFO]: [ Bot-Notification.botService ] Successfully sent alert to ${userId} on attempt ${attempt}`,
        )
        return
      } catch (error) {
        console.warn(
          `[WARNING]: [ Bot-Notification.botService ] Failed to send alert to ${userId} on attempt ${attempt}.`,
        )
        if (attempt === MAX_RETRIES) {
          console.error(
            `[ERROR]: [ Bot-Notification.botService ] Exhausted 5 attempts to send message to ${userId}.`,
          )
          const errMessage = error instanceof Error ? error.stack || error.message : String(error)
          console.error(
            `[ERROR]: [ Bot-Notification.botService ] Final Error details: ${errMessage}`,
          )
          break
        }

        // Wait before retrying (exponential backoff: 1s, 2s, 4s, 8s)
        const delay = Math.pow(2, attempt - 1) * 1000
        await sleep(delay)
      }
    }
  }
}
