import type {Formation} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {dynoExtensions, restartDynos, scaleDynos} from './dyno.js'

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: vi.fn(),
}))

function platformCtx(platform: Record<string, unknown>): ResourceCtx {
  return {data: {} as never, platform: platform as never}
}

function mockPatch(result: unknown): ReturnType<typeof vi.fn> {
  const patch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
    headers: {'content-type': 'application/json'},
    status: 200,
  }))
  vi.mocked(HerokuApiClient).mockImplementation(function (this: {patch: typeof patch}) {
    this.patch = patch
  } as never)
  return patch
}

describe('dyno resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scaleDynos routes a single update to PATCH /apps/:app/formation/:type', async () => {
    const formation = {quantity: 3, type: 'web'} as Formation
    const patch = mockPatch(formation)
    const ctx = platformCtx({})

    const result = await scaleDynos(ctx, 'app-1', {quantity: 3, type: 'web'})

    expect(HerokuApiClient).toHaveBeenCalledWith({service: 'platform'})
    expect(patch).toHaveBeenCalledWith('/apps/app-1/formation/web', {body: {quantity: 3}})
    expect(result).toEqual(formation)
  })

  it('scaleDynos routes an updates array to PATCH /apps/:app/formation', async () => {
    const formations = [{quantity: 2, type: 'web'} as Formation]
    const patch = mockPatch(formations)
    const ctx = platformCtx({})

    const updates = [{quantity: 2, type: 'web'}]
    const result = await scaleDynos(ctx, 'app-1', updates)

    expect(patch).toHaveBeenCalledWith('/apps/app-1/formation', {body: {updates}})
    expect(result).toEqual(formations)
  })

  it('scaleDynos accepts string quantity for relative scaling', async () => {
    const patch = mockPatch([{quantity: 3, type: 'web'}])
    const ctx = platformCtx({})

    await scaleDynos(ctx, 'app-1', [{quantity: '+1', type: 'web'}])

    expect(patch).toHaveBeenCalledWith('/apps/app-1/formation', {body: {updates: [{quantity: '+1', type: 'web'}]}})
  })

  it('scaleDynos accepts flat size string', async () => {
    const patch = mockPatch({quantity: 2, size: 'Standard-1X', type: 'web'})
    const ctx = platformCtx({})

    await scaleDynos(ctx, 'app-1', {quantity: 2, size: 'Standard-1X', type: 'web'})

    expect(patch).toHaveBeenCalledWith('/apps/app-1/formation/web', {body: {quantity: 2, size: 'Standard-1X'}})
  })

  it('scaleDynos throws if the signal is already aborted', async () => {
    const ctx = platformCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(scaleDynos(ctx, 'app-1', {quantity: 1, type: 'web'}, {signal: controller.signal})).rejects.toThrow()
    expect(HerokuApiClient).not.toHaveBeenCalled()
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

  it('dynoExtensions declares service: platform, resource: dyno', () => {
    expect(dynoExtensions.service).toBe('platform')
    expect(dynoExtensions.resource).toBe('dyno')
  })

  it('dynoExtensions factory exposes scale and restart methods', () => {
    const ctx = platformCtx({dyno: {}, formation: {}})
    const methods = dynoExtensions.factory(ctx)
    expect(typeof methods.scale).toBe('function')
    expect(typeof methods.restart).toBe('function')
  })
})
