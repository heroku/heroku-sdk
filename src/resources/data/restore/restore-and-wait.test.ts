/* eslint-disable camelcase */
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../../test-types/heroku-sdk-options.js'
import {restoreAndWait} from './restore-and-wait.js'

function buildCtx(opts: {
  infoByApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
  restoreCreate?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  const dataClient = {
    restore: {
      create: opts.restoreCreate ?? vi.fn(),
    },
    transfer: {
      infoByApp: opts.infoByApp ?? vi.fn(),
    },
    withOptions() {
      return dataClient
    },
  }
  return {
    ...legacyResourceCtx,
    data: dataClient as never,
    platform: {
      addOn: {resolution: vi.fn()},
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const attachmentMatch = [
  {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-1', name: 'pg-attached'}} as AddOnAttachment,
]

describe('restoreAndWait', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the addon, restores from a backup URL, and waits for it to finish', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const restoreCreate = vi.fn().mockResolvedValue({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
    const infoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'restore-1'})
    const ctx = buildCtx({infoByApp, resolutionByAttachment, restoreCreate})

    const result = await restoreAndWait(ctx, 'app-1', 'DATABASE_URL', 'https://example.com/backup.dump')

    expect(restoreCreate).toHaveBeenCalledWith('addon-1', {backup_url: 'https://example.com/backup.dump', extensions: undefined})
    expect(infoByApp).toHaveBeenCalledWith('app-1', 'restore-1', {verbose: undefined})
    expect(result).toEqual({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'restore-1'})
  })

  it('passes extensions through to restore.create', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const restoreCreate = vi.fn().mockResolvedValue({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
    const infoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'restore-1'})
    const ctx = buildCtx({infoByApp, resolutionByAttachment, restoreCreate})

    await restoreAndWait(ctx, 'app-1', 'DATABASE_URL', 'https://example.com/backup.dump', {extensions: ['postgis']})

    expect(restoreCreate).toHaveBeenCalledWith('addon-1', {backup_url: 'https://example.com/backup.dump', extensions: ['postgis']})
  })

  it('fires restorePoller and waitPoller hooks around their respective steps', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const restoreCreate = vi.fn().mockResolvedValue({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
    const infoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'restore-1'})
    const ctx = buildCtx({infoByApp, resolutionByAttachment, restoreCreate})
    const restorePoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}

    await restoreAndWait(ctx, 'app-1', 'DATABASE_URL', 'https://example.com/backup.dump', {restorePoller, waitPoller})

    expect(restorePoller.onStart).toHaveBeenCalledWith(attachmentMatch[0].addon)
    expect(restorePoller.onStop).toHaveBeenCalledWith(attachmentMatch[0].addon)
    expect(waitPoller.onStart).toHaveBeenCalledWith({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
    expect(waitPoller.onStop).toHaveBeenCalledWith({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
  })
})
