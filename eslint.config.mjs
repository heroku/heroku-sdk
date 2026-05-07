import herokuConfig from '@heroku-cli/test-utils/eslint-config'

export default [
  ...herokuConfig,
  // Project-specific overrides
  {
    rules: {
      'n/no-unsupported-features/node-builtins': 'warn',
    },
  },
]
