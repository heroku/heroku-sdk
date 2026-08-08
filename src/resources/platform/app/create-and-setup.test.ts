import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {createAndSetup} from './create-and-setup.js'

function ctx(platform: Record<string, unknown>): ResourceCtx {
  return {data: {} as never, metrics: {} as never, platform: platform as never}
}

describe('createAndSetup', () => {
  it('creates a personal app then sets addons, config vars, buildpack in parallel', async () => {
    // eslint-disable-next-line camelcase
    const app = {name: 'example', web_url: 'https://example.herokuapp.com'}
    const create = vi.fn().mockResolvedValue(app)
    const addOnCreate = vi.fn().mockResolvedValue({})
    const configVarUpdate = vi.fn().mockResolvedValue({})
    const buildpackUpdate = vi.fn().mockResolvedValue({})

    const result = await createAndSetup(
      ctx({
        addOn: {create: addOnCreate},
        app: {create},
        buildpackInstallation: {update: buildpackUpdate},
        configVar: {update: configVarUpdate},
        teamApp: {create: vi.fn()},
      }),
      {
        addons: [{plan: 'heroku-postgresql:mini'}],
        buildpack: 'heroku/nodejs',
        configVars: {FOO: 'bar'},
        name: 'example',
      },
    )

    expect(create).toHaveBeenCalledOnce()
    expect(addOnCreate).toHaveBeenCalledWith('example', {attachment: undefined, plan: 'heroku-postgresql:mini'})
    expect(configVarUpdate).toHaveBeenCalledWith('example', {FOO: 'bar'})
    expect(buildpackUpdate).toHaveBeenCalledWith('example', {updates: [{buildpack: 'heroku/nodejs'}]})
    expect(result).toEqual(app)
  })

  it('routes to teamApp.create when team is set', async () => {
    const teamCreate = vi.fn().mockResolvedValue({name: 'team-app'})
    const appCreate = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: vi.fn()},
        app: {create: appCreate},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: teamCreate},
      }),
      {name: 'team-app', team: 'acme'},
    )
    expect(teamCreate).toHaveBeenCalledOnce()
    expect(appCreate).not.toHaveBeenCalled()
  })

  it('skips setup steps that have no input', async () => {
    const create = vi.fn().mockResolvedValue({name: 'bare'})
    const addOnCreate = vi.fn()
    const configVarUpdate = vi.fn()
    const buildpackUpdate = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: addOnCreate},
        app: {create},
        buildpackInstallation: {update: buildpackUpdate},
        configVar: {update: configVarUpdate},
        teamApp: {create: vi.fn()},
      }),
      {name: 'bare'},
    )
    expect(addOnCreate).not.toHaveBeenCalled()
    expect(configVarUpdate).not.toHaveBeenCalled()
    expect(buildpackUpdate).not.toHaveBeenCalled()
  })

  it('fires poller.onStart/onStop once around the parallel setup batch (PR #3857 convention)', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: vi.fn().mockResolvedValue({})},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}},
    )
    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('does not fire the poller when there are no setup steps', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: vi.fn()},
        app: {create: vi.fn().mockResolvedValue({name: 'bare'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {name: 'bare'},
      {poller: {onStart, onStop}},
    )
    expect(onStart).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('honors abort signal', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(createAndSetup(ctx({app: {create: vi.fn()}}), {name: 'app'}, {signal: ac.signal})).rejects.toThrow()
  })

  it('threads the signal into requests via withOptions', async () => {
    const app = {name: 'example'}
    const create = vi.fn().mockResolvedValue(app)
    const addOnCreate = vi.fn().mockResolvedValue({})
    const scoped = {
      addOn: {create: addOnCreate},
      app: {create},
      buildpackInstallation: {update: vi.fn()},
      configVar: {update: vi.fn()},
      teamApp: {create: vi.fn()},
    }
    const withOptions = vi.fn().mockReturnValue(scoped)
    const ac = new AbortController()

    await createAndSetup(
      ctx({withOptions}),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'example'},
      {signal: ac.signal},
    )

    expect(withOptions).toHaveBeenCalledWith({signal: ac.signal})
    // Requests route through the scoped client, not the base one.
    expect(create).toHaveBeenCalledOnce()
    expect(addOnCreate).toHaveBeenCalledWith('example', {attachment: undefined, plan: 'heroku-postgresql:mini'})
  })

  it('fires onStart before any setup request is dispatched', async () => {
    const calls: string[] = []
    const onStart = vi.fn(() => calls.push('onStart'))
    const onStop = vi.fn(() => calls.push('onStop'))
    const addOnCreate = vi.fn(async () => {
      calls.push('addOn.create')
      return {}
    })
    await createAndSetup(
      ctx({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}},
    )
    expect(calls).toEqual(['onStart', 'addOn.create', 'onStop'])
  })

  it('does not call onStop when a setup step rejects', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await expect(createAndSetup(
      ctx({
        addOn: {create: vi.fn().mockRejectedValue(new Error('boom'))},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}},
    )).rejects.toThrow('boom')

    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('exposed on appExtensions.factory', async () => {
    const {appExtensions} = await import('./index.js')
    const methods = appExtensions.factory(ctx({app: {create: vi.fn()}}))
    expect(typeof methods.createAndSetup).toBe('function')
  })
})
