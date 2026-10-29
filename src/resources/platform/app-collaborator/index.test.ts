import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {appCollaboratorExtensions} from './index.js'

describe('appCollaboratorExtensions', () => {
  it('declares an extension-only platform namespace', () => {
    const ctx = {platform: {} as never} as ResourceCtx
    const methods = appCollaboratorExtensions.factory(ctx)

    expect(appCollaboratorExtensions.service).toBe('platform')
    expect(appCollaboratorExtensions.resource).toBe('appCollaborator')
    expect(typeof methods.removeSelf).toBe('function')
  })

  it('delegates removeSelf with the extension context', async () => {
    const deleted = {id: 'collaborator-1'}
    const info = vi.fn().mockResolvedValue({email: 'member@example.com'})
    const deleteCollaborator = vi.fn().mockResolvedValue(deleted)
    const ctx = {
      platform: {account: {info}, collaborator: {delete: deleteCollaborator}} as never,
    } as ResourceCtx
    const methods = appCollaboratorExtensions.factory(ctx)

    const result = await methods.removeSelf('team-app')

    expect(info).toHaveBeenCalledExactlyOnceWith()
    expect(deleteCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', 'member@example.com')
    expect(result).toBe(deleted)
  })
})
