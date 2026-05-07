import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ['dist/**', '**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
      include: ['src/**/*.ts'],
      provider: 'v8',
    },
  },
})
