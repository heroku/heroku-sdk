/* eslint-disable camelcase */
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
    // Self-referential and recordable so a `.withOptions({signal})` chain resolves back to dataClient.
    withOptions: vi.fn(() => dataClient),
  }
  return {
    ...legacyResourceCtx,
    data: dataClient as never,
    platform: {
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

const attachmentMatch = [
  {
    addon: {
      app: {id: 'app-uuid', name: 'app-1'},
      id: 'addon-1',
      name: 'pg-attached',
      plan: {name: 'heroku-postgresql:essential-0'},
    },
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'attachment-id',
    name: 'DATABASE',
  },
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

  it('runs the capture and the wait poll on the signal-bound client, never the unbound base', async () => {
    const controller = new AbortController()

    // The signal-bound client is a DISTINCT object from the base, each with its
    // own spies. A self-referential mock (withOptions returning the same object)
    // can't tell the two apart, so a regression that dropped the pre-wait
    // binding and captured via the unbound `ctx.data` would still pass because
    // `waitForTransfer` re-binds downstream. Here both the capture and the wait
    // poll must land on the bound client and never the base.
    const boundCreate = vi.fn().mockResolvedValue({from_type: 'pg_dump', to_type: 'gof3r', uuid: 'xfer-1'})
    const boundInfoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const bound = {backup: {create: boundCreate}, transfer: {infoByApp: boundInfoByApp}}

    const baseCreate = vi.fn()
    const baseInfoByApp = vi.fn()
    const base: Record<string, unknown> = {backup: {create: baseCreate}, transfer: {infoByApp: baseInfoByApp}}
    const withOptions = vi.fn((opts: {signal?: AbortSignal}) => (opts.signal ? bound : base))
    base.withOptions = withOptions

    const ctx: ResourceCtx = {
      ...legacyResourceCtx,
      data: base as never,
      platform: {
        addOnAttachment: {resolution: vi.fn().mockResolvedValue(attachmentMatch)},
        withHeaders() {
          return this
        },
        withOptions() {
          return this
        },
      } as never,
    }

    await captureAndWait(ctx, 'app-1', 'DATABASE_URL', {signal: controller.signal})

    expect(withOptions).toHaveBeenCalledWith({signal: controller.signal})
    expect(boundCreate).toHaveBeenCalledOnce()
    expect(boundInfoByApp).toHaveBeenCalled()
    expect(baseCreate).not.toHaveBeenCalled()
    expect(baseInfoByApp).not.toHaveBeenCalled()
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
