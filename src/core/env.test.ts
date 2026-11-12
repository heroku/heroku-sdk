import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {readEnv} from './env.js'

describe('readEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reads a variable from process.env', () => {
    vi.stubEnv('HEROKU_SDK_TEST_VAR', 'value')
    expect(readEnv('HEROKU_SDK_TEST_VAR')).toBe('value')
  })

  it('returns undefined for an unset variable', () => {
    expect(readEnv('HEROKU_SDK_TEST_UNSET_VAR')).toBeUndefined()
  })

  it('returns undefined without a process global, as in a browser', () => {
    vi.stubGlobal('process')
    expect(readEnv('PATH')).toBeUndefined()
  })

  it('returns undefined when process has no env', () => {
    vi.stubGlobal('process', {})
    expect(readEnv('PATH')).toBeUndefined()
  })
})
