import {
  describe, expect, it, vi,
} from 'vitest'

const constructorSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      constructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/data/routes', () => ({
  addon: {
    list: {method: 'GET', path: '/addons'},
  },
}))

const withDataHost = (hosts: {data?: string; postgresql?: string}, callback: () => void) => {
  const previousDataHost = process.env.HEROKU_DATA_HOST
  const previousPostgresqlHost = process.env.HEROKU_POSTGRESQL_HOST

  if (hosts.data === undefined) delete process.env.HEROKU_DATA_HOST
  else process.env.HEROKU_DATA_HOST = hosts.data

  if (hosts.postgresql === undefined) delete process.env.HEROKU_POSTGRESQL_HOST
  else process.env.HEROKU_POSTGRESQL_HOST = hosts.postgresql

  try {
    callback()
  } finally {
    if (previousDataHost === undefined) delete process.env.HEROKU_DATA_HOST
    else process.env.HEROKU_DATA_HOST = previousDataHost

    if (previousPostgresqlHost === undefined) delete process.env.HEROKU_POSTGRESQL_HOST
    else process.env.HEROKU_POSTGRESQL_HOST = previousPostgresqlHost
  }
}

describe('createDataClient', () => {
  it("forwards service: 'data' by default", async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({}, () => createDataClient({token: 'test-token'}))

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({service: 'data', token: 'test-token'}))
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    createDataClient({baseUrl: 'https://example.test', service: 'custom', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://example.test', service: 'custom'}))
  })

  it('uses HEROKU_DATA_HOST before HEROKU_POSTGRESQL_HOST and normalizes hostnames to HTTPS URLs', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'api.data.heroku.com', postgresql: 'postgresql-api.heroku.com'}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.data.heroku.com', service: 'data'}))
  })

  it('uses HEROKU_POSTGRESQL_HOST when HEROKU_DATA_HOST is unset', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({postgresql: 'https://postgresql-api.heroku.com:443'}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://postgresql-api.heroku.com', service: 'data'}))
  })

  it('preserves the CLI data API default when no host is configured', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.data.heroku.com', service: 'data'}))
  })

  it('preserves an explicit baseUrl over invalid environment hosts', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'https://user:secret@attacker.example/path'}, () => {
      createDataClient({baseUrl: 'https://explicit.example', token: 'test-token'})
    })

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://explicit.example', service: 'data'}))
  })

  it('validates environment routing when an empty baseUrl would otherwise fall through', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'attacker.example'}, () => {
      expect(() => createDataClient({baseUrl: ''})).toThrow('untrusted data API host')
    })

    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it('does not apply data-host environment overrides to an explicitly selected non-data service', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'attacker.example'}, () => createDataClient({service: 'custom'}))

    expect(constructorSpy).toHaveBeenCalledWith({service: 'custom'})
  })

  it.each([
    'attacker.example',
    'https://heroku.com.attacker.example',
    'http://api.data.heroku.com',
    'ftp://localhost',
    'https://user:secret@api.data.heroku.com',
    'https://api.data.heroku.com/path',
    'https://api.data.heroku.com?secret=value',
    'https://api.data.heroku.com#secret',
    'https://api.data.heroku.com:',
    'https://api.data.heroku.com/..',
    'https://[invalid-ipv6',
  ])('rejects unsafe environment host %s without exposing its value', async host => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')
    let thrown: unknown

    withDataHost({data: host}, () => {
      try {
        createDataClient()
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).not.toContain(host)
    expect((thrown as Error).message).not.toContain('secret')
    expect(constructorSpy).not.toHaveBeenCalled()
  })

  it.each([
    'http://localhost:8080',
    'https://localhost:8443',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
  ])('allows local data host %s', async host => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: host}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: host, service: 'data'}))
  })

  it('allows trusted Heroku subdomains over HTTPS with the default port', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'https://api.heroku.com:443'}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.heroku.com', service: 'data'}))
  })

  it('allows a trusted Heroku host with an explicit non-default port', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    withDataHost({data: 'https://api.data.heroku.com:8443'}, () => createDataClient())

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.data.heroku.com:8443', service: 'data'}))
  })
})
