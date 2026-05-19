import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {PlatformClient} from '../../../services/platform.js'

import {resolveAddonId} from './resolve-addon-id.js'

function platform(matches: AddOnAttachment[]): PlatformClient {
  return {
    addOnAttachment: {
      resolution: vi.fn().mockResolvedValue(matches),
    },
  } as never
}

describe('resolveAddonId', () => {
  it('returns the addon id from the first matching attachment', async () => {
    const matches: AddOnAttachment[] = [
      {addon: {id: 'addon-1'}},
    ] as AddOnAttachment[]

    const id = await resolveAddonId(platform(matches), 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    expect(id).toBe('addon-1')
  })

  it('defaults the addon identifier to DATABASE_URL when omitted', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: {id: 'addon-2'}}] as AddOnAttachment[])
    const client = {addOnAttachment: {resolution}} as never as PlatformClient

    await resolveAddonId(client, 'app-1')

    // eslint-disable-next-line camelcase
    expect(resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'})
  })

  it('throws when no attachment is found', async () => {
    await expect(resolveAddonId(platform([]), 'app-1', 'NOPE')).rejects.toThrow(/Could not resolve add-on/)
  })
})
