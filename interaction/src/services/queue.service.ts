import { Queue } from 'bullmq'

const queueName = 'default'
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
}

export const interactionQueue = new Queue(queueName, { connection })

export const addToQueue = async (data: any) => {
  return interactionQueue.add('interaction-job', data)
}
