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
    const app = {name: 'example'}
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
        region: 'us',
        stack: 'heroku-24',
      },
    )

    expect(create).toHaveBeenCalledWith({name: 'example', region: 'us', stack: 'heroku-24'})
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

  it('routes to teamApp.create when only space is set', async () => {
    const teamCreate = vi.fn().mockResolvedValue({name: 'space-app'})
    const appCreate = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: vi.fn()},
        app: {create: appCreate},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: teamCreate},
      }),
      {name: 'space-app', space: 'my-space'},
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

  it('does not call configVar.update for an empty configVars object', async () => {
    const create = vi.fn().mockResolvedValue({name: 'bare'})
    const configVarUpdate = vi.fn()
    await createAndSetup(
      ctx({
        addOn: {create: vi.fn()},
        app: {create},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: configVarUpdate},
        teamApp: {create: vi.fn()},
      }),
      {configVars: {}, name: 'bare'},
    )
    expect(configVarUpdate).not.toHaveBeenCalled()
  })

  it('maps an addon `as` alias to {attachment: {name}}', async () => {
    const addOnCreate = vi.fn().mockResolvedValue({})
    await createAndSetup(
      ctx({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {addons: [{as: 'DATABASE_URL', plan: 'heroku-postgresql:standard-0'}], name: 'app'},
    )
    expect(addOnCreate).toHaveBeenCalledWith('app', {
      attachment: {name: 'DATABASE_URL'},
      plan: 'heroku-postgresql:standard-0',
    })
  })

  it('creates one addon per entry when multiple addons are given', async () => {
    const addOnCreate = vi.fn().mockResolvedValue({})
    await createAndSetup(
      ctx({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: vi.fn()},
      }),
      {
        addons: [
          {plan: 'heroku-postgresql:mini'},
          {plan: 'heroku-redis:mini'},
        ],
        name: 'app',
      },
    )
    expect(addOnCreate).toHaveBeenCalledTimes(2)
    expect(addOnCreate).toHaveBeenCalledWith('app', {attachment: undefined, plan: 'heroku-postgresql:mini'})
    expect(addOnCreate).toHaveBeenCalledWith('app', {attachment: undefined, plan: 'heroku-redis:mini'})
  })

  it('fires poller.onStart/onStop once around the parallel setup batch', async () => {
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
    expect(onStart).toHaveBeenCalledWith({kind: 'setup', label: 'setup'})
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('does not call onStop when a setup step rejects', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    const configVarUpdate = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(createAndSetup(
      ctx({
        addOn: {create: vi.fn().mockResolvedValue({})},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: configVarUpdate},
        teamApp: {create: vi.fn()},
      }),
      {configVars: {FOO: 'bar'}, name: 'app'},
      {poller: {onStart, onStop}},
    )).rejects.toThrow('boom')
    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
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

  it('rejects an already-aborted signal before creating the app', async () => {
    const appCreate = vi.fn()
    const teamCreate = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(createAndSetup(
      ctx({
        addOn: {create: vi.fn()},
        app: {create: appCreate},
        buildpackInstallation: {update: vi.fn()},
        configVar: {update: vi.fn()},
        teamApp: {create: teamCreate},
      }),
      {name: 'app'},
      {signal: controller.signal},
    )).rejects.toThrow()
    expect(appCreate).not.toHaveBeenCalled()
    expect(teamCreate).not.toHaveBeenCalled()
  })
})
