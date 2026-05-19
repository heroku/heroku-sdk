import herokuConfig from '@heroku-cli/test-utils/eslint-config'
import vitest from '@heroku-cli/test-utils/eslint-config/vitest'

export default [
  ...herokuConfig,
  ...vitest,
  // Project-specific overrides
  {
    rules: {
      'n/no-unsupported-features/node-builtins': 'warn',
    },
  },
]
