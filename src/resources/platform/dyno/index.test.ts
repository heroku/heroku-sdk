import type {HerokuApiClient} from '@heroku/heroku-fetch'
import type {Formation} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {dynoExtensions, restartDynos, scaleDynos} from './index.js'

function platformCtx(platform: Record<string, unknown>): ResourceCtx {
  const p: Record<string, unknown> = {...platform}
  p.withOptions = vi.fn().mockReturnValue(p)
  return {data: {} as never, platform: p as never}
}

describe('dyno resource', () => {
  it('scaleDynos routes a single update object to formation.update', async () => {
    const formation = {quantity: 3, type: 'web'} as Formation
    const update = vi.fn().mockResolvedValue(formation)
    const batchUpdate = vi.fn()
    const ctx = platformCtx({formation: {batchUpdate, update}})

    const result = await scaleDynos(ctx, 'app-1', {quantity: 3, type: 'web'})

    expect(update).toHaveBeenCalledWith('app-1', 'web', {quantity: 3})
    expect(batchUpdate).not.toHaveBeenCalled()
    expect(result).toBe(formation)
  })

  it('scaleDynos routes an updates array to formation.batchUpdate', async () => {
    const formations = [{quantity: 2, type: 'web'} as Formation]
    const update = vi.fn()
    const batchUpdate = vi.fn().mockResolvedValue(formations)
    const ctx = platformCtx({formation: {batchUpdate, update}})

    const updates = [{quantity: 2, type: 'web'}]
    const result = await scaleDynos(ctx, 'app-1', updates)

    expect(batchUpdate).toHaveBeenCalledWith('app-1', {updates})
    expect(update).not.toHaveBeenCalled()
    expect(result).toBe(formations)
  })

  it('scaleDynos accepts string quantity for relative scaling', async () => {
    const formation = {quantity: 3, type: 'web'} as Formation
    const batchUpdate = vi.fn().mockResolvedValue([formation])
    const ctx = platformCtx({formation: {batchUpdate}})

    await scaleDynos(ctx, 'app-1', [{quantity: '+1', type: 'web'}])

    expect(batchUpdate).toHaveBeenCalledWith('app-1', {updates: [{quantity: '+1', type: 'web'}]})
  })

  it('scaleDynos accepts flat size string', async () => {
    const formation = {quantity: 2, size: 'Standard-1X', type: 'web'} as Formation
    const update = vi.fn().mockResolvedValue(formation)
    const ctx = platformCtx({formation: {update}})

    await scaleDynos(ctx, 'app-1', {quantity: 2, size: 'Standard-1X', type: 'web'})

    expect(update).toHaveBeenCalledWith('app-1', 'web', {quantity: 2, size: 'Standard-1X'})
  })

  it('scaleDynos throws if the signal is already aborted', async () => {
    const update = vi.fn()
    const ctx = platformCtx({formation: {update}})
    const controller = new AbortController()
    controller.abort()

    await expect(scaleDynos(ctx, 'app-1', {quantity: 1, type: 'web'}, {signal: controller.signal})).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('restartDynos restarts all dynos when no target is provided', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1')

    expect(restartAll).toHaveBeenCalledWith('app-1')
    expect(restart).not.toHaveBeenCalled()
    expect(restartFormation).not.toHaveBeenCalled()
  })

  it('restartDynos restarts a formation when target is a process type', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1', {type: 'web'})

    expect(restartFormation).toHaveBeenCalledWith('app-1', 'web')
  })

  it('restartDynos restarts a specific dyno when target is a dyno name', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1', {dyno: 'web.1'})

    expect(restart).toHaveBeenCalledWith('app-1', 'web.1')
  })

  it('restartDynos binds the signal to the platform client so the request aborts in flight', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})
    const controller = new AbortController()

    await restartDynos(ctx, 'app-1', undefined, {signal: controller.signal})

    expect((ctx.platform as unknown as {withOptions: ReturnType<typeof vi.fn>}).withOptions)
      .toHaveBeenCalledWith({signal: controller.signal})
  })

  it('threads ctx into exchangeExecCredentials, execStatus, and listExtended via makeClient', async () => {
    const headers = {'content-type': 'application/json'}
    // Bodies are intentionally minimal — this test asserts the wiring (that
    // makeClient is called), not the parsed payloads. A fresh Response per call
    // avoids reusing an already-read body across the two GETs.
    const put = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', {headers})))
    const get = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', {headers})))
    const fakeClient = {get, put} as unknown as HerokuApiClient
    const makeClient = vi.fn(() => fakeClient)
    const ctx: ResourceCtx = {...platformCtx({dyno: {}, formation: {}}), makeClient}
    const methods = dynoExtensions.factory(ctx)

    await methods.exchangeExecCredentials('app-1', {apiKey: 'k', dyno: 'web.1', publicKey: 'ssh-rsa X'})
    await methods.execStatus('app-1', {apiKey: 'k'})
    await methods.listExtended('app-1')

    // Each standalone helper must receive ctx so its client is built through
    // makeClient. A dropped ctx arg at the wiring site would silently fall back
    // to a bare HerokuApiClient and lose the threaded identity/signal.
    expect(makeClient).toHaveBeenCalledTimes(3)
    expect(makeClient).toHaveBeenNthCalledWith(1, 'platform', expect.objectContaining({service: 'custom'}))
    expect(makeClient).toHaveBeenNthCalledWith(2, 'platform', expect.objectContaining({service: 'custom'}))
    expect(makeClient).toHaveBeenNthCalledWith(3, 'platform', expect.objectContaining({service: 'platform'}))
  })

  it('dynoExtensions declares service: platform, resource: dyno', () => {
    expect(dynoExtensions.service).toBe('platform')
    expect(dynoExtensions.resource).toBe('dyno')
  })

  it('dynoExtensions factory exposes scale, restart, run, and waitForInfo methods', () => {
    const ctx = platformCtx({dyno: {}, formation: {}})
    const methods = dynoExtensions.factory(ctx)
    expect(typeof methods.scale).toBe('function')
    expect(typeof methods.restart).toBe('function')
    expect(typeof methods.run).toBe('function')
    expect(typeof methods.waitForInfo).toBe('function')
  })
})
