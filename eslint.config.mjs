import herokuConfig from '@heroku-cli/test-utils/eslint-config'
import vitest from '@heroku-cli/test-utils/eslint-config/vitest'

// The SDK runs in browsers as well as Node, so its source can't use Node-only globals.
// Extend the shared config's restricted globals rather than replacing them.
const [severity, sharedOptions] = herokuConfig.findLast(config => config.rules?.['no-restricted-globals']).rules['no-restricted-globals']
const browserSafeGlobals = [severity, {
  ...sharedOptions,
  globals: [
    ...sharedOptions.globals,
    ...['Buffer', 'process', '__dirname', '__filename', 'require', 'setImmediate', 'clearImmediate'].map(name => ({
      message: `${name} is Node-only; the SDK must also run in browsers.`,
      name,
    })),
  ],
}]

export default [
  ...herokuConfig,
  ...vitest,
  // Project-specific overrides
  {
    rules: {
      'n/no-unsupported-features/node-builtins': 'warn',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/test-utils.ts', 'src/**/test-utils/**'],
    rules: {
      'no-restricted-globals': browserSafeGlobals,
    },
  },
]
