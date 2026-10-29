/* eslint-disable camelcase -- Dashboard Backend favorite wire format */
import type {FavoriteListResult} from '@heroku/types/dashboard-backend'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  addByAppName,
  AlreadyFavoriteError,
  AppNotFoundError,
  FavoriteCreateError,
  favoriteExtensions,
  NotFavoriteError,
  removeByAppName,
} from './index.js'

function buildCtx({favorites = []}: {favorites?: FavoriteListResult} = {}) {
  const list = vi.fn().mockResolvedValue(favorites)
  const create = vi.fn()
  const remove = vi.fn().mockResolvedValue()
  const dashboardBackend = {
    favorite: {create, delete: remove, list},
    withOptions: vi.fn(),
  }
  dashboardBackend.withOptions.mockReturnValue(dashboardBackend)

  return {
    create,
    ctx: {dashboardBackend} as unknown as ResourceCtx,
    delete: remove,
    list,
    withOptions: dashboardBackend.withOptions,
  }
}

function favorite(id: string, resource_name: string): FavoriteListResult[number] {
  return {
    id, resource_id: `id-${id}`, resource_name, type: 'app',
  }
}

describe('dashboard-backend favorite extensions', () => {
  describe('addByAppName', () => {
    it('lists app favorites, creates by app name, and returns the create result', async () => {
      const {create, ctx, list} = buildCtx({favorites: [favorite('other', 'other-app')]})
      const created = {id: 'favorite-1', resource_id: 'example-app', type: 'app'}
      create.mockResolvedValue(created)

      await expect(addByAppName(ctx, 'example-app')).resolves.toEqual(created)

      expect(list).toHaveBeenCalledOnce()
      expect(list).toHaveBeenCalledWith({type: 'app'})
      expect(create).toHaveBeenCalledOnce()
      expect(create).toHaveBeenCalledWith({resource_id: 'example-app', type: 'app'})
    })

    it('accepts a no-content create response', async () => {
      const {create, ctx} = buildCtx()
      create.mockResolvedValue()

      await expect(addByAppName(ctx, 'example-app')).resolves.toBeUndefined()
    })

    it('throws AlreadyFavoriteError only for an exact resource name match', async () => {
      const {create, ctx} = buildCtx({favorites: [favorite('favorite-1', 'example-app-extended')]})
      create.mockResolvedValue({id: 'favorite-2', resource_id: 'example-app', type: 'app'})

      await expect(addByAppName(ctx, 'example-app')).resolves.toMatchObject({id: 'favorite-2'})

      const exactMatchCtx = buildCtx({favorites: [favorite('favorite-3', 'example-app')]})
      const error = await addByAppName(exactMatchCtx.ctx, 'example-app').catch(error_ => error_)

      expect(error).toBeInstanceOf(AlreadyFavoriteError)
      expect(error).toMatchObject({appName: 'example-app', name: 'AlreadyFavoriteError'})
      expect(exactMatchCtx.create).not.toHaveBeenCalled()
    })

    it('maps a create-phase 404 to AppNotFoundError with the original cause', async () => {
      const {create, ctx} = buildCtx()
      const cause = Object.assign(new Error('missing'), {statusCode: 404})
      create.mockRejectedValue(cause)

      const error = await addByAppName(ctx, 'missing-app').catch(error_ => error_)

      expect(error).toBeInstanceOf(AppNotFoundError)
      expect(error).toMatchObject({appName: 'missing-app', cause, name: 'AppNotFoundError'})
    })

    it('propagates a native AbortError from an in-flight create request', async () => {
      const {create, ctx} = buildCtx()
      const controller = new AbortController()
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      create.mockImplementation(async () => {
        controller.abort(new Error('custom cancellation'))
        throw abortError
      })

      const error = await addByAppName(ctx, 'example-app', {signal: controller.signal}).catch(error_ => error_)

      expect(error).toBe(abortError)
      expect(error).not.toBeInstanceOf(AppNotFoundError)
      expect(error).not.toBeInstanceOf(FavoriteCreateError)
    })

    it('propagates a custom abort reason rejected by the create request', async () => {
      const {create, ctx} = buildCtx()
      const controller = new AbortController()
      const reason = new Error('custom cancellation')
      create.mockImplementation(async () => {
        controller.abort(reason)
        throw reason
      })

      await expect(addByAppName(ctx, 'example-app', {signal: controller.signal})).rejects.toBe(reason)
    })

    it('wraps a create failure when a separate custom abort reason races it', async () => {
      const {create, ctx} = buildCtx()
      const controller = new AbortController()
      const cause = new Error('service unavailable')
      create.mockImplementation(async () => {
        controller.abort(new Error('separate cancellation'))
        throw cause
      })

      const error = await addByAppName(ctx, 'example-app', {signal: controller.signal}).catch(error_ => error_)

      expect(error).toBeInstanceOf(FavoriteCreateError)
      expect(error).toMatchObject({appName: 'example-app', cause, name: 'FavoriteCreateError'})
    })

    it('wraps create failures with the original Error cause', async () => {
      const {create, ctx} = buildCtx()
      const cause = new Error('service unavailable')
      create.mockRejectedValue(cause)

      const error = await addByAppName(ctx, 'example-app').catch(error_ => error_)

      expect(error).toBeInstanceOf(FavoriteCreateError)
      expect(error).toMatchObject({appName: 'example-app', cause, name: 'FavoriteCreateError'})
    })

    it.each([null, undefined, {reason: 'non-error rejection'}])('preserves non-Error create rejection cause: %s', async cause => {
      const {create, ctx} = buildCtx()
      create.mockRejectedValue(cause)

      const error = await addByAppName(ctx, 'example-app').catch(error_ => error_)

      expect(error).toBeInstanceOf(FavoriteCreateError)
      expect(Object.hasOwn(error, 'cause')).toBe(true)
      expect(error.cause).toBe(cause)
    })

    it('does not translate a 404 from the list phase', async () => {
      const {create, ctx, list} = buildCtx()
      const cause = Object.assign(new Error('list missing'), {statusCode: 404})
      list.mockRejectedValue(cause)

      await expect(addByAppName(ctx, 'example-app')).rejects.toBe(cause)
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('removeByAppName', () => {
    it('deletes the first exact match when multiple favorites share the app name', async () => {
      const {ctx, delete: deleteFavorite, list} = buildCtx({
        favorites: [
          favorite('first-favorite', 'example-app'),
          favorite('second-favorite', 'example-app'),
        ],
      })

      await expect(removeByAppName(ctx, 'example-app')).resolves.toBeUndefined()

      expect(list).toHaveBeenCalledWith({type: 'app'})
      expect(deleteFavorite).toHaveBeenCalledOnce()
      expect(deleteFavorite).toHaveBeenCalledWith('first-favorite')
    })

    it('throws NotFavoriteError when no exact match exists', async () => {
      const {ctx, delete: deleteFavorite} = buildCtx({favorites: [favorite('near-match', 'example-app-prod')]})

      await expect(removeByAppName(ctx, 'example-app')).rejects.toBeInstanceOf(NotFavoriteError)
      await expect(removeByAppName(ctx, 'example-app')).rejects.toMatchObject({appName: 'example-app'})
      expect(deleteFavorite).not.toHaveBeenCalled()
    })

    it('passes list-phase 404 errors through unchanged', async () => {
      const {ctx, delete: deleteFavorite, list} = buildCtx()
      const cause = Object.assign(new Error('list failed'), {statusCode: 404})
      list.mockRejectedValue(cause)

      await expect(removeByAppName(ctx, 'example-app')).rejects.toBe(cause)
      expect(deleteFavorite).not.toHaveBeenCalled()
    })

    it('passes delete errors through unchanged', async () => {
      const {ctx, delete: deleteFavorite} = buildCtx({favorites: [favorite('favorite-1', 'example-app')]})
      const cause = new Error('delete failed')
      deleteFavorite.mockRejectedValue(cause)

      await expect(removeByAppName(ctx, 'example-app')).rejects.toBe(cause)
    })
  })

  describe('cancellation', () => {
    it('binds the signal to list and create requests', async () => {
      const {create, ctx, withOptions} = buildCtx()
      const controller = new AbortController()
      create.mockResolvedValue()

      await addByAppName(ctx, 'example-app', {signal: controller.signal})

      expect(withOptions).toHaveBeenCalledWith({signal: controller.signal})
    })

    it('checks abort before starting a request', async () => {
      const {create, ctx, list} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(addByAppName(ctx, 'example-app', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'})
      expect(list).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    })

    it('checks abort between list and create', async () => {
      const {create, ctx, list} = buildCtx()
      const controller = new AbortController()
      list.mockImplementation(async () => {
        controller.abort()
        return []
      })

      await expect(addByAppName(ctx, 'example-app', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'})
      expect(create).not.toHaveBeenCalled()
    })

    it('checks abort between list and delete', async () => {
      const {ctx, delete: deleteFavorite, list} = buildCtx({favorites: [favorite('favorite-1', 'example-app')]})
      const controller = new AbortController()
      list.mockImplementation(async () => {
        controller.abort()
        return [favorite('favorite-1', 'example-app')]
      })

      await expect(removeByAppName(ctx, 'example-app', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'})
      expect(deleteFavorite).not.toHaveBeenCalled()
    })
  })

  it('exposes both methods through the favorite resource extension', async () => {
    const {create, ctx, delete: deleteFavorite, list} = buildCtx()
    const methods = favoriteExtensions.factory(ctx)
    create.mockResolvedValue()
    list.mockResolvedValueOnce([]).mockResolvedValue([favorite('favorite-1', 'example-app')])

    await methods.addByAppName('example-app')
    await methods.removeByAppName('example-app')

    expect(create).toHaveBeenCalledWith({resource_id: 'example-app', type: 'app'})
    expect(deleteFavorite).toHaveBeenCalledWith('favorite-1')
  })
})
