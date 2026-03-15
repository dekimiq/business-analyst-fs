import { configApp } from '@adonisjs/eslint-config'

export default configApp({
  namingConvention: {
    ignoreInterfacesThatStartWith: ['I'],
  },
})
