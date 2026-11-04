/* eslint-disable camelcase */
import type {PostgresLevelInfoResult} from '@heroku/types/data'

import {describe, expect, it} from 'vitest'

import {
  listAvailableActions,
  listAvailableLevels,
  MAX_POOL_INSTANCES,
  postgresPoolExtensions,
} from './postgres-pool.js'

const LEVELS: PostgresLevelInfoResult = {
  items: [
    {
      connection_limit: 100, memory_in_gb: 4, name: 'advanced-0', vcpu: 1,
    },
    {
      connection_limit: 200, memory_in_gb: 8, name: 'advanced-2', vcpu: 2,
    },
    {
      connection_limit: 400, memory_in_gb: 16, name: 'advanced-4', vcpu: 4,
    },
  ],
}

describe('postgresPoolExtensions factory', () => {
  it('exposes listAvailableActions and listAvailableLevels', () => {
    const methods = postgresPoolExtensions.factory({data: {} as never, platform: {} as never})
    expect(typeof methods.listAvailableActions).toBe('function')
    expect(typeof methods.listAvailableLevels).toBe('function')
  })
})

describe('listAvailableLevels', () => {
  it('marks every level available when no pool is given', () => {
    const levels = listAvailableLevels(LEVELS)

    expect(levels).toHaveLength(3)
    expect(levels.every(l => l.available)).toBe(true)
    expect(levels[0].level).toEqual({
      connection_limit: 100, memory_in_gb: 4, name: 'advanced-0', vcpu: 1,
    })
  })

  it('marks the pool\'s current level unavailable, the rest available', () => {
    const levels = listAvailableLevels(LEVELS, {expected_level: 'advanced-2'})

    const current = levels.find(l => l.level.name === 'advanced-2')!
    expect(current.available).toBe(false)
    expect(current).toMatchObject({available: false, reason: 'current_level'})

    const others = levels.filter(l => l.level.name !== 'advanced-2')
    expect(others.every(l => l.available)).toBe(true)
  })
})

describe('listAvailableActions', () => {
  it('offers the leader change_level + remove_ha when it runs a standby', () => {
    const actions = listAvailableActions({expected_count: 2, name: 'leader'})

    expect(actions).toEqual([
      {type: 'change_level'},
      {count: 1, type: 'remove_ha'},
    ])
  })

  it('offers the leader change_level + add_ha when it runs a single instance', () => {
    const actions = listAvailableActions({expected_count: 1, name: 'leader'})

    expect(actions).toEqual([
      {type: 'change_level'},
      {count: 2, type: 'add_ha'},
    ])
  })

  it('offers a follower change_level + update_count + destroy, bounding the count by the cluster budget', () => {
    const actions = listAvailableActions({expected_count: 3, name: 'follower-1'}, {followerInstanceCount: 3})

    expect(actions).toEqual([
      {type: 'change_level'},
      {max: MAX_POOL_INSTANCES - 3, min: 1, type: 'update_count'},
      {type: 'destroy'},
    ])
  })

  it('defaults a follower update_count max to the full cluster budget', () => {
    const actions = listAvailableActions({expected_count: 1, name: 'follower-1'})
    const updateCount = actions.find(a => a.type === 'update_count')

    expect(updateCount).toEqual({max: MAX_POOL_INSTANCES, min: 1, type: 'update_count'})
  })
})
