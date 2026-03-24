import { defineConfig } from '@adonisjs/lucid'
import { env } from '@project/env'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER_BACKEND,
        password: env.DB_PASSWORD_BACKEND,
        database: env.NODE_ENV === 'test' ? `${env.DB_NAME}_test` : env.DB_NAME,
      },
      searchPath: ['backend'],
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
