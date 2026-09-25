/* eslint-disable camelcase */
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../../test-types/heroku-sdk-options.js'
import {captureAndWait} from './capture-and-wait.js'

function buildCtx(opts: {
  backupCreate?: ReturnType<typeof vi.fn>
  infoByApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  const dataClient = {
    backup: {
      create: opts.backupCreate ?? vi.fn(),
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

describe('captureAndWait', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the addon, starts a capture, and waits for it to finish', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const backupCreate = vi.fn().mockResolvedValue({from_type: 'pg_dump', to_type: 'gof3r', uuid: 'xfer-1'})
    const infoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({backupCreate, infoByApp, resolutionByAttachment})

    const result = await captureAndWait(ctx, 'app-1', 'DATABASE_URL')

    expect(backupCreate).toHaveBeenCalledWith('addon-1')
    expect(infoByApp).toHaveBeenCalledWith('app-1', 'xfer-1', {verbose: undefined})
    expect(result).toEqual({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
  })

  it('fires capturePoller and waitPoller hooks around their respective steps', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const backupCreate = vi.fn().mockResolvedValue({from_type: 'pg_dump', to_type: 'gof3r', uuid: 'xfer-1'})
    const infoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({backupCreate, infoByApp, resolutionByAttachment})
    const capturePoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}

    await captureAndWait(ctx, 'app-1', 'DATABASE_URL', {capturePoller, waitPoller})

    expect(capturePoller.onStart).toHaveBeenCalledWith(attachmentMatch[0].addon)
    expect(capturePoller.onStop).toHaveBeenCalledWith(attachmentMatch[0].addon)
    expect(waitPoller.onStart).toHaveBeenCalledWith({from_type: 'pg_dump', to_type: 'gof3r', uuid: 'xfer-1'})
    expect(waitPoller.onStop).toHaveBeenCalledWith({from_type: 'pg_dump', to_type: 'gof3r', uuid: 'xfer-1'})
  })
})
