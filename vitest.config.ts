import {configDefaults, defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ['dist/**', '**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
      include: ['src/**/*.ts'],
      provider: 'v8',
    },
    // Exclude the release workflow's checkout from test discovery. The release
    // workflow checks out heroku/npm-release-workflows into ./workflows-repo
    // inside this workspace; vitest's default include globs the whole tree and
    // would collect that repo's specs (which then time out). Location-agnostic,
    // mirroring @heroku-cli/test-utils/vitest-config — adopt that base once it's
    // published and this can drop out.
    exclude: [...configDefaults.exclude, 'workflows-repo/**'],
  },
})
