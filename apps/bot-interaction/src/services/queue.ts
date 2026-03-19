import { getNotificationQueue } from '../modules/notifications/producer.js'
import type { Queue } from 'bullmq'
import type { NotificationJobData } from '../modules/notifications/types.js'

let notificationQueue: Queue<NotificationJobData> | null = null

export function initQueue(): Queue<NotificationJobData> {
  if (!notificationQueue) {
    notificationQueue = getNotificationQueue()
  }
  return notificationQueue
}

export function getQueue(): Queue<NotificationJobData> {
  if (!notificationQueue) {
    throw new Error('Queue not initialized. Call initQueue() first.')
  }
  return notificationQueue
}

export async function closeQueue(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close()
    notificationQueue = null
  }
}
