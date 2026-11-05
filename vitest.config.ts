import {configDefaults, defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ['dist/**', '**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
      include: ['src/**/*.ts'],
      provider: 'v8',
    },
    // Exclude the release workflow's ./workflows-repo checkout from discovery.
    exclude: [...configDefaults.exclude, 'workflows-repo/**'],
  },
})
