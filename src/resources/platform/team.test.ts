/* eslint-disable camelcase -- platform delinquency wire format */
import type {Team, TeamDelinquency} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {getTeamWithDelinquency, teamExtensions} from './team.js'

type FakePlatform = {
  team: {info: ReturnType<typeof vi.fn>}
  teamDelinquency: {info: ReturnType<typeof vi.fn>}
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  delinquencyInfo?: ReturnType<typeof vi.fn>
  teamInfo?: ReturnType<typeof vi.fn>
} = {}): {ctx: ResourceCtx; platform: FakePlatform} {
  const platform: FakePlatform = {
    team: {info: stubs.teamInfo ?? vi.fn().mockResolvedValue({})},
    teamDelinquency: {info: stubs.delinquencyInfo ?? vi.fn().mockResolvedValue(null)},
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    ctx: {platform: platform as never} as ResourceCtx,
    platform,
  }
}

describe('getTeamWithDelinquency', () => {
  it('returns the team together with its delinquency', async () => {
    const team = {id: 'team-1', name: 'my-team'} as Team
    const delinquency = {
      scheduled_deletion_time: null,
      scheduled_suspension_time: '2026-02-01T00:00:00.000Z',
    } as TeamDelinquency

    const {ctx, platform} = buildCtx({
      delinquencyInfo: vi.fn().mockResolvedValue(delinquency),
      teamInfo: vi.fn().mockResolvedValue(team),
    })

    const result = await getTeamWithDelinquency(ctx, 'my-team')

    expect(result).toEqual({delinquency, team})
    expect(platform.team.info).toHaveBeenCalledExactlyOnceWith('my-team')
    expect(platform.teamDelinquency.info).toHaveBeenCalledExactlyOnceWith('my-team')
  })

  it('soft-fails the delinquency lookup to null without sinking the team fetch', async () => {
    const team = {id: 'team-1'} as Team
    const {ctx} = buildCtx({
      delinquencyInfo: vi.fn().mockRejectedValue(new Error('boom')),
      teamInfo: vi.fn().mockResolvedValue(team),
    })

    const result = await getTeamWithDelinquency(ctx, 'my-team')

    expect(result.team).toEqual(team)
    expect(result.delinquency).toBeNull()
  })

  it('propagates an error from the team lookup', async () => {
    const {ctx} = buildCtx({
      teamInfo: vi.fn().mockRejectedValue(new Error('team-boom')),
    })

    await expect(getTeamWithDelinquency(ctx, 'my-team')).rejects.toThrow('team-boom')
  })

  it('throws if the abort signal is already aborted, without calling any route', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(getTeamWithDelinquency(ctx, 'my-team', {signal: controller.signal})).rejects.toThrow()
    expect(platform.team.info).not.toHaveBeenCalled()
    expect(platform.teamDelinquency.info).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions when provided', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()

    await getTeamWithDelinquency(ctx, 'my-team', {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })

  it('does not call withOptions when no signal is provided', async () => {
    const {ctx, platform} = buildCtx()

    await getTeamWithDelinquency(ctx, 'my-team')

    expect(platform.withOptions).not.toHaveBeenCalled()
  })
})

describe('teamExtensions.getWithDelinquency wiring', () => {
  it('exposes a getWithDelinquency method that delegates to getTeamWithDelinquency', async () => {
    const {ctx, platform} = buildCtx({
      teamInfo: vi.fn().mockResolvedValue({id: 'team-1'} as Team),
    })
    const methods = teamExtensions.factory(ctx)

    expect(typeof methods.getWithDelinquency).toBe('function')
    const result = await methods.getWithDelinquency('my-team')
    expect(result.team).toEqual({id: 'team-1'})
    expect(platform.team.info).toHaveBeenCalledExactlyOnceWith('my-team')
  })
})
