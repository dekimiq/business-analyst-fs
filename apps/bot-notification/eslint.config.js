export default [
  {
    ignores: ['dist/', 'node_modules/', '.turbo/'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
]
