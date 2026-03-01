const swagger = {
  path: new URL('../', import.meta.url).pathname,

  title: 'Business Analyst FS — API',
  version: '0.1.0',
  description: 'Внутренний бэкенд: интеграции с Яндекс.Директ и AmoCRM.',

  tagIndex: 2,
  snakeCase: true,
  debug: false,

  ignore: ['/swagger', '/docs', '/health'],

  preferredPutPatch: 'PATCH',

  common: {
    parameters: {},
    headers: {},
  },

  info: {
    title: 'Business Analyst FS',
    version: '0.1.0',
    description: 'Внутренний бэкенд: интеграции с Яндекс.Директ и AmoCRM.',
  },

  servers: [{ url: 'http://localhost:3333', description: 'Local Dev' }],

  securitySchemes: {},
  authMiddlewares: ['auth'],
}

export default swagger
