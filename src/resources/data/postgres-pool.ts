import type {PostgresLevelInfoResult, PostgresPoolInfoResult} from '@heroku/types/data'

import {extendResource} from '../../core/extend-resource.js'

/** The maximum number of follower-pool instances a database cluster can hold. */
export const MAX_POOL_INSTANCES = 13

/** The name the leader pool always carries; any other name is a follower pool. */
export const LEADER_POOL_NAME = 'leader'

/** A single compute level from `postgresLevel.info`. */
export type LevelItem = PostgresLevelInfoResult['items'][number]

/**
 * A level paired with whether it's selectable for a given pool. The level a
 * pool is already at is reported unavailable (`reason: 'current_level'`),
 * mirroring the CLI's "current level" disabling; every other level is
 * available. Callers get the full `LevelItem` (vcpu/memory/connection_limit),
 * not just a name, so they can render without a second lookup.
 */
export type AvailableLevel = {
  level: LevelItem
} & (
  | {available: false; reason: 'current_level'}
  | {available: true}
)

/**
 * An action that can be taken on a pool. A discriminated union on `type`:
 * `change_level` applies to any pool; `add_ha`/`remove_ha` are the leader's
 * HA toggle (carrying the instance `count` the mutation sets); `update_count`
 * (carrying the selectable `min`/`max`) and `destroy` apply to follower pools.
 */
export type PoolAction
  = | {count: 1; type: 'remove_ha'}
  | {count: 2; type: 'add_ha'}
  | {max: number; min: number; type: 'update_count'}
  | {type: 'change_level'}
  | {type: 'destroy'}

export type ListAvailableActionsOptions = {
  /**
   * Total instances across *all* follower pools in the cluster, *including*
   * the pool being queried. Used to bound a follower's `update_count` range:
   * the edited pool's own instances are excluded so it can grow back into the
   * budget they occupy (`max = MAX_POOL_INSTANCES - (count - pool.expected_count)`,
   * floored at 1). Required so an omitted count can't silently widen the range
   * to the full budget. Ignored for the leader pool.
   */
  followerInstanceCount: number
}

/**
 * Derives the selectable compute levels for a pool. Pure — no request.
 *
 * Returns every level from `levels`, marking the pool's current
 * `expected_level` unavailable (`reason: 'current_level'`) so the UI can
 * disable it. With no `pool`, every level is available (e.g. choosing the
 * level for a brand-new pool).
 */
export function listAvailableLevels(
  levels: PostgresLevelInfoResult,
  pool?: Pick<PostgresPoolInfoResult, 'expected_level'>,
): AvailableLevel[] {
  return levels.items.map(level =>
    level.name === pool?.expected_level
      ? {available: false, level, reason: 'current_level'}
      : {available: true, level})
}

/**
 * Derives the actions available on a pool. Pure — no request.
 *
 * The leader pool can always change level and can toggle high availability:
 * `remove_ha` (down to a single instance) when it currently runs a standby
 * (`expected_count > 1`), otherwise `add_ha` (up to two instances). A follower
 * pool can change level, update its instance count (bounded by the cluster's
 * remaining instance budget), or be destroyed.
 */
export function listAvailableActions(
  pool: Pick<PostgresPoolInfoResult, 'expected_count' | 'name'>,
  options: ListAvailableActionsOptions,
): PoolAction[] {
  if (pool.name === LEADER_POOL_NAME) {
    return [
      {type: 'change_level'},
      pool.expected_count > 1 ? {count: 1, type: 'remove_ha'} : {count: 2, type: 'add_ha'},
    ]
  }

  const {followerInstanceCount} = options
  // `followerInstanceCount` includes this pool's own instances; exclude them so
  // the pool can grow back into the budget it already occupies. Floor at 1 so
  // the range never collapses below `min` even if the counts are inconsistent.
  const otherInstances = Math.max(0, followerInstanceCount - pool.expected_count)
  const max = Math.max(1, MAX_POOL_INSTANCES - otherInstances)
  return [
    {type: 'change_level'},
    {max, min: 1, type: 'update_count'},
    {type: 'destroy'},
  ]
}

export const postgresPoolExtensions = extendResource('data', 'postgresPool', () => ({
  listAvailableActions,
  listAvailableLevels,
}))
