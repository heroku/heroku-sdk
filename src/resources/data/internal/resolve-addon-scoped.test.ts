import {NotFoundError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import {AddonNotFoundError} from '../../platform/add-on/errors.js'
import {resolveAddonScopedThenGlobal} from './resolve-addon-scoped.js'

const ADDON = {app: {id: 'app-2-uuid', name: 'app-2'}, id: 'addon-1', name: 'redis-1'}

function notFound(resource?: string) {
  return new NotFoundError(new Response(null, {status: 404}), {id: 'not_found', message: 'not found', resource})
}

function platformWith(resolution: ReturnType<typeof vi.fn>) {
  return {addOn: {resolution}} as never
}

describe('resolveAddonScopedThenGlobal', () => {
  it('returns the scoped match without a global retry', async () => {
    const resolution = vi.fn().mockResolvedValue([ADDON])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'redis-1', {appIdentity: 'app-1'})).toEqual(ADDON)
    expect(resolution).toHaveBeenCalledOnce()
    expect(resolution).toHaveBeenCalledWith({addon: 'redis-1', app: 'app-1'})
  })

  it.each([
    ['an add-on 404', () => Promise.reject(notFound('add_on'))],
    ['a 404 without a resource', () => Promise.reject(notFound())],
    ['an empty match', () => Promise.resolve([])],
  ])('retries globally after %s', async (_label, scoped) => {
    const resolution = vi.fn().mockImplementationOnce(scoped).mockResolvedValueOnce([ADDON])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'redis-1', {appIdentity: 'app-1'})).toEqual(ADDON)
    expect(resolution).toHaveBeenNthCalledWith(2, {addon: 'redis-1'})
  })

  it('rethrows a 404 for another resource (e.g. a mistyped app) without retrying', async () => {
    const error = notFound('app')
    const resolution = vi.fn().mockRejectedValue(error)

    await expect(resolveAddonScopedThenGlobal(platformWith(resolution), 'redis-1', {appIdentity: 'typo-app'})).rejects.toBe(error)
    expect(resolution).toHaveBeenCalledOnce()
  })

  it.each([
    ['an app::addon identity', 'app-2::REDIS', {appIdentity: 'app-1'}],
    ['no app identity', 'redis-1', {}],
  ])('resolves globally once for %s', async (_label, identity, options) => {
    const resolution = vi.fn().mockResolvedValue([])

    await expect(resolveAddonScopedThenGlobal(platformWith(resolution), identity, options)).rejects.toBeInstanceOf(AddonNotFoundError)
    expect(resolution).toHaveBeenCalledOnce()
    expect(resolution).toHaveBeenCalledWith({addon: identity})
  })

  it('filters by add-on service on both attempts', async () => {
    const pg = {...ADDON, addon_service: {name: 'heroku-postgresql'}} // eslint-disable-line camelcase
    const resolution = vi.fn()
      .mockResolvedValueOnce([{...ADDON, addon_service: {name: 'heroku-redis'}}]) // eslint-disable-line camelcase
      .mockResolvedValueOnce([pg])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'db', {addonService: 'heroku-postgresql', appIdentity: 'app-1'})).toEqual(pg)
  })
})
