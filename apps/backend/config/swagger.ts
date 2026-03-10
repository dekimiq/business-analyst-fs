const swagger = {
  path: `${__dirname}/../`,
  title: 'Business Analyst API',
  version: '1.0.0',
  description: 'REST API для управления синхронизацией данных Яндекс.Директ и AmoCRM',
  tagIndex: 2,
  ignore: ['/swagger', '/docs'],
  preferredPutPatch: 'PATCH',
  snakeCase: true,
  common: {
    parameters: {},
    headers: {},
  },
}

export default swagger
