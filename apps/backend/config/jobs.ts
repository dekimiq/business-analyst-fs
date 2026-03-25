import { env } from '@project/env'
import { defineConfig } from 'adonisjs-jobs'

const jobsConfig = defineConfig({
  connection: {
    host: env.REDIS_HOST || 'localhost',
    port: env.REDIS_PORT || 6379,
    db: env.REDIS_DB_BACKEND || 0,
  },

  queue: 'sync',
  queues: ['sync'],

  options: {
    /**
     * The total number of attempts to try the job until it completes.
     */
    attempts: 0,

    /**
     * Backoff setting for automatic retries if the job fails
     */
    backoff: {
      type: 'exponential',
      delay: 5000,
    },

    /**
     * If true, removes the job when it successfully completes
     * When given a number, it specifies the maximum amount of
     * jobs to keep, or you can provide an object specifying max
     * age and/or count to keep. It overrides whatever setting is used in the worker.
     * Default behavior is to keep the job in the completed set.
     */
    removeOnComplete: 1000,

    /**
     * If true, removes the job when it fails after all attempts.
     * When given a number, it specifies the maximum amount of
     * jobs to keep, or you can provide an object specifying max
     * age and/or count to keep. It overrides whatever setting is used in the worker.
     * Default behavior is to keep the job in the failed set.
     */
    removeOnFail: 1000,
  },
})

export default jobsConfig
