import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import type { Registry } from '../.adonisjs/client/registry/schema.d.ts'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */
declare module '@japa/api-client/types' {
  interface RoutesRegistry extends Registry {}
}

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  apiClient(),
  sessionApiClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
import pkg from 'pg'
const { Client } = pkg
import { env } from '@project/env'

async function ensureTestDatabase() {
  const testDbName = `${env.DB_NAME}_test`

  const client = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'postgres',
  })

  try {
    await client.connect()
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDbName])

    if (res.rowCount === 0) {
      console.log(`📡 Creating test database: ${testDbName}...`)
      await client.query(`CREATE DATABASE "${testDbName}"`)
    }
  } catch (error: any) {
    console.error(`❌ Error ensuring test database: ${error.message}`)
  } finally {
    await client.end()
  }

  const testClient = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: testDbName,
  })

  try {
    await testClient.connect()
    await testClient.query('CREATE SCHEMA IF NOT EXISTS backend')
    // Даем права юзеру бэкенда на работу в этой схеме
    await testClient.query(`GRANT ALL ON SCHEMA backend TO "${env.DB_USER_BACKEND}"`)
    await testClient.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA backend GRANT ALL ON TABLES TO "${env.DB_USER_BACKEND}"`
    )
    console.log(`✅ Schema 'backend' ensured in ${testDbName}`)
  } catch (error: any) {
    console.error(`❌ Error ensuring 'backend' schema: ${error.message}`)
  } finally {
    await testClient.end()
  }
}

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    async () => {
      await ensureTestDatabase()
      await testUtils.db().migrate()
    },
  ],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
