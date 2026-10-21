/* eslint-disable camelcase */
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

  it('runs the restore and the wait poll on the signal-bound client, never the unbound base', async () => {
    const controller = new AbortController()

    // The signal-bound client is a DISTINCT object from the base, each with its
    // own spies. A self-referential mock (withOptions returning the same object)
    // can't tell the two apart, so a regression that dropped the pre-wait
    // binding and restored via the unbound `ctx.data` would still pass because
    // `waitForTransfer` re-binds downstream. Here both the restore and the wait
    // poll must land on the bound client and never the base.
    const boundCreate = vi.fn().mockResolvedValue({from_type: 'gof3r', to_type: 'pg_dump', uuid: 'restore-1'})
    const boundInfoByApp = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'restore-1'})
    const bound = {restore: {create: boundCreate}, transfer: {infoByApp: boundInfoByApp}}

    const baseCreate = vi.fn()
    const baseInfoByApp = vi.fn()
    const base: Record<string, unknown> = {restore: {create: baseCreate}, transfer: {infoByApp: baseInfoByApp}}
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

    await restoreAndWait(ctx, 'app-1', 'DATABASE_URL', 'https://example.com/backup.dump', {signal: controller.signal})

    expect(withOptions).toHaveBeenCalledWith({signal: controller.signal})
    expect(boundCreate).toHaveBeenCalledOnce()
    expect(boundInfoByApp).toHaveBeenCalled()
    expect(baseCreate).not.toHaveBeenCalled()
    expect(baseInfoByApp).not.toHaveBeenCalled()
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
