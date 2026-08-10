import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {createAndSetup} from './create-and-setup.js'

function ctx(platform: Record<string, unknown>): ResourceCtx {
  return {data: {} as never, metrics: {} as never, platform: platform as never}
}

// A `withHeaders` that returns the same platform is needed because
// `waitForProvisioning` calls `ctx.platform.withHeaders({...})`. Returning a
// provisioned add-on from `addOn.create` means the poll loop never runs, but
// the helper still reads `withHeaders` up front.
function platformWith(overrides: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    addOn: {create: vi.fn().mockResolvedValue({name: 'addon', state: 'provisioned'})},
    app: {create: vi.fn().mockResolvedValue({name: 'app'})},
    buildpackInstallation: {update: vi.fn().mockResolvedValue([])},
    configVar: {update: vi.fn().mockResolvedValue({})},
    teamApp: {create: vi.fn()},
    ...overrides,
  }
  base.withHeaders = vi.fn().mockReturnValue(base)
  return base
}

describe('createAndSetup', () => {
  it('creates a personal app then provisions addons, config vars, buildpack', async () => {
    // eslint-disable-next-line camelcase
    const app = {name: 'example', web_url: 'https://example.herokuapp.com'}
    const create = vi.fn().mockResolvedValue(app)
    const addOnCreate = vi.fn().mockResolvedValue({name: 'pg', state: 'provisioned'})
    const configVarUpdate = vi.fn().mockResolvedValue({})
    const buildpackUpdate = vi.fn().mockResolvedValue([])

    const result = await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate},
        app: {create},
        buildpackInstallation: {update: buildpackUpdate},
        configVar: {update: configVarUpdate},
      })),
      {
        addons: [{plan: 'heroku-postgresql:mini'}],
        buildpack: 'heroku/nodejs',
        configVars: {FOO: 'bar'},
        name: 'example',
      },
      {waitIntervalMs: 0},
    )

    expect(create).toHaveBeenCalledOnce()
    expect(addOnCreate).toHaveBeenCalledWith('example', {attachment: undefined, plan: 'heroku-postgresql:mini'})
    expect(configVarUpdate).toHaveBeenCalledWith('example', {FOO: 'bar'})
    expect(buildpackUpdate).toHaveBeenCalledWith('example', {updates: [{buildpack: 'heroku/nodejs'}]})
    expect(result).toEqual(app)
  })

  it('applies config vars only after add-on provisioning completes', async () => {
    const calls: string[] = []
    const addOnCreate = vi.fn(async () => {
      calls.push('addOn.create')
      // A provisioned create response means waitForProvisioning does not poll.
      return {name: 'pg', state: 'provisioned'}
    })
    const configVarUpdate = vi.fn(async () => {
      calls.push('configVar.update')
      return {}
    })

    await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        configVar: {update: configVarUpdate},
      })),
      {
        addons: [{plan: 'heroku-postgresql:mini'}],
        configVars: {FOO: 'bar'},
        name: 'app',
      },
      {waitIntervalMs: 0},
    )

    // Phase 1 (add-on create → provisioned) strictly precedes phase 2 (config vars).
    expect(calls).toEqual(['addOn.create', 'configVar.update'])
  })

  it('waits for a still-provisioning add-on before applying config vars', async () => {
    const calls: string[] = []
    // create returns provisioning; the poller reads infoByApp until provisioned.
    const addOnCreate = vi.fn(async () => {
      calls.push('addOn.create')
      return {name: 'pg', state: 'provisioning'}
    })
    const infoByApp = vi.fn(async () => {
      calls.push('addOn.infoByApp')
      return {name: 'pg', state: 'provisioned'}
    })
    const configVarUpdate = vi.fn(async () => {
      calls.push('configVar.update')
      return {}
    })

    await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate, infoByApp},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        configVar: {update: configVarUpdate},
      })),
      {
        addons: [{plan: 'heroku-postgresql:mini'}],
        configVars: {DATABASE_URL: null},
        name: 'app',
      },
      {waitIntervalMs: 0},
    )

    expect(calls).toEqual(['addOn.create', 'addOn.infoByApp', 'configVar.update'])
  })

  it('routes to teamApp.create when team is set', async () => {
    const teamCreate = vi.fn().mockResolvedValue({name: 'team-app'})
    const appCreate = vi.fn()
    await createAndSetup(
      ctx(platformWith({
        app: {create: appCreate},
        teamApp: {create: teamCreate},
      })),
      {name: 'team-app', team: 'acme'},
    )
    expect(teamCreate).toHaveBeenCalledOnce()
    expect(appCreate).not.toHaveBeenCalled()
  })

  it('routes to teamApp.create when space is set', async () => {
    const teamCreate = vi.fn().mockResolvedValue({name: 'space-app'})
    const appCreate = vi.fn()
    await createAndSetup(
      ctx(platformWith({
        app: {create: appCreate},
        teamApp: {create: teamCreate},
      })),
      {name: 'space-app', space: 'my-space'},
    )
    expect(teamCreate).toHaveBeenCalledOnce()
    expect(appCreate).not.toHaveBeenCalled()
  })

  it('throws when the created app has no name', async () => {
    await expect(createAndSetup(
      ctx(platformWith({app: {create: vi.fn().mockResolvedValue({})}})),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {waitIntervalMs: 0},
    )).rejects.toThrow('created app has no name')
  })

  it('skips setup steps that have no input', async () => {
    const create = vi.fn().mockResolvedValue({name: 'bare'})
    const addOnCreate = vi.fn()
    const configVarUpdate = vi.fn()
    const buildpackUpdate = vi.fn()
    await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate},
        app: {create},
        buildpackInstallation: {update: buildpackUpdate},
        configVar: {update: configVarUpdate},
      })),
      {name: 'bare'},
    )
    expect(addOnCreate).not.toHaveBeenCalled()
    expect(configVarUpdate).not.toHaveBeenCalled()
    expect(buildpackUpdate).not.toHaveBeenCalled()
  })

  it('fires poller.onStart/onStop once around the setup batch (PR #3857 convention)', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await createAndSetup(
      ctx(platformWith({
        addOn: {create: vi.fn().mockResolvedValue({name: 'pg', state: 'provisioned'})},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
      })),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}, waitIntervalMs: 0},
    )
    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
    // Poller<void>: both callbacks fire with no arguments (symmetric contract).
    expect(onStart).toHaveBeenCalledWith()
    expect(onStop).toHaveBeenCalledWith()
  })

  it('does not fire the poller when there are no setup steps', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await createAndSetup(
      ctx(platformWith({
        app: {create: vi.fn().mockResolvedValue({name: 'bare'})},
      })),
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
    const addOnCreate = vi.fn().mockResolvedValue({name: 'pg', state: 'provisioned'})
    const scoped = platformWith({
      addOn: {create: addOnCreate},
      app: {create},
    })
    const withOptions = vi.fn().mockReturnValue(scoped)
    const ac = new AbortController()

    await createAndSetup(
      ctx({withOptions}),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'example'},
      {signal: ac.signal, waitIntervalMs: 0},
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
      return {name: 'pg', state: 'provisioned'}
    })
    await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
      })),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}, waitIntervalMs: 0},
    )
    expect(calls).toEqual(['onStart', 'addOn.create', 'onStop'])
  })

  it('does not call onStop when a setup step rejects', async () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    await expect(createAndSetup(
      ctx(platformWith({
        addOn: {create: vi.fn().mockRejectedValue(new Error('boom'))},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
      })),
      {addons: [{plan: 'heroku-postgresql:mini'}], name: 'app'},
      {poller: {onStart, onStop}, waitIntervalMs: 0},
    )).rejects.toThrow(AggregateError)

    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('settles every started phase-1 op before throwing (no orphaned in-flight)', async () => {
    let secondSettled = false
    const addOnCreate = vi.fn()
      // First add-on rejects.
      .mockRejectedValueOnce(new Error('first failed'))
      // Second add-on resolves a bit later; must still settle before the throw.
      .mockImplementationOnce(async () => {
        await new Promise(resolve => {
          setTimeout(resolve, 5)
        })
        secondSettled = true
        return {name: 'second', state: 'provisioned'}
      })
    const configVarUpdate = vi.fn().mockResolvedValue({})

    const error = await createAndSetup(
      ctx(platformWith({
        addOn: {create: addOnCreate},
        app: {create: vi.fn().mockResolvedValue({name: 'app'})},
        configVar: {update: configVarUpdate},
      })),
      {
        addons: [{plan: 'plan-a'}, {plan: 'plan-b'}],
        configVars: {FOO: 'bar'},
        name: 'app',
      },
      {waitIntervalMs: 0},
    ).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toHaveLength(1)
    // Both phase-1 ops were awaited to settlement before the throw.
    expect(secondSettled).toBe(true)
    // Phase 2 never started because phase 1 failed.
    expect(configVarUpdate).not.toHaveBeenCalled()
  })

  it('exposed on appExtensions.factory', async () => {
    const {appExtensions} = await import('./index.js')
    const methods = appExtensions.factory(ctx({app: {create: vi.fn()}}))
    expect(typeof methods.createAndSetup).toBe('function')
  })
})
