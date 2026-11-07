import {NotFoundError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import {AddonNotFoundError} from '../../platform/add-on/errors.js'
import {resolveAddonScopedThenGlobal} from './resolve-addon-scoped.js'

const ADDON = {app: {id: 'app-2-uuid', name: 'app-2'}, id: 'addon-1', name: 'pg-1'}

function notFound(resource?: string) {
  return new NotFoundError(new Response(null, {status: 404}), {id: 'not_found', message: 'not found', resource})
}

function platformWith(resolution: ReturnType<typeof vi.fn>) {
  return {addOn: {resolution}} as never
}

describe('resolveAddonScopedThenGlobal', () => {
  it('returns the scoped match without a global retry', async () => {
    const resolution = vi.fn().mockResolvedValue([ADDON])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'pg-1', {appIdentity: 'app-1'})).toEqual(ADDON)
    expect(resolution).toHaveBeenCalledOnce()
    expect(resolution).toHaveBeenCalledWith({addon: 'pg-1', app: 'app-1'})
  })

  it.each([
    ['an add-on 404', () => Promise.reject(notFound('add_on'))],
    ['an empty match', () => Promise.resolve([])],
  ])('retries globally after %s', async (_label, scoped) => {
    const resolution = vi.fn().mockImplementationOnce(scoped).mockResolvedValueOnce([ADDON])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'pg-1', {appIdentity: 'app-1'})).toEqual(ADDON)
    expect(resolution).toHaveBeenNthCalledWith(2, {addon: 'pg-1'})
  })

  it.each([
    ['an app 404 (e.g. a mistyped app)', 'app'],
    ['a 404 without a resource label', undefined],
  ])('rethrows %s without retrying', async (_label, resource) => {
    const error = notFound(resource)
    const resolution = vi.fn().mockRejectedValue(error)

    await expect(resolveAddonScopedThenGlobal(platformWith(resolution), 'pg-1', {appIdentity: 'typo-app'})).rejects.toBe(error)
    expect(resolution).toHaveBeenCalledOnce()
  })

  it.each([
    ['an app::addon identity', 'app-2::HEROKU_POSTGRESQL_BLUE', {appIdentity: 'app-1'}],
    ['no app identity', 'pg-1', {}],
  ])('resolves globally once for %s', async (_label, identity, options) => {
    const resolution = vi.fn().mockResolvedValue([])

    await expect(resolveAddonScopedThenGlobal(platformWith(resolution), identity, options)).rejects.toBeInstanceOf(AddonNotFoundError)
    expect(resolution).toHaveBeenCalledOnce()
    expect(resolution).toHaveBeenCalledWith({addon: identity})
  })

  it('filters by add-on service on both attempts', async () => {
    const pg = {...ADDON, addon_service: {name: 'heroku-postgresql'}} // eslint-disable-line camelcase
    const resolution = vi.fn()
      .mockResolvedValueOnce([{...ADDON, addon_service: {name: 'papertrail'}}]) // eslint-disable-line camelcase
      .mockResolvedValueOnce([pg])

    expect(await resolveAddonScopedThenGlobal(platformWith(resolution), 'db', {addonService: 'heroku-postgresql', appIdentity: 'app-1'})).toEqual(pg)
  })
})
