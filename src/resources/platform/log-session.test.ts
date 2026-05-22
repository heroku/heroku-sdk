import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {logSessionExtensions, streamLogs} from './log-session.js'

const SESSION_BASE = {
  id: 'session-1',
  // eslint-disable-next-line camelcase
  logplex_url: 'https://logs.example.com/stream?token=abc',
}

function buildCtx(
  createImpl: (...args: unknown[]) => unknown,
  generation: 'cedar' | 'fir' | undefined = 'cedar',
): {
  appInfo: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  ctx: ResourceCtx
  withHeaders: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(createImpl as never)
  const appInfo = vi.fn().mockResolvedValue({generation, id: 'app-id', name: 'my-app'})
  const platform = {
    app: {info: appInfo},
    logSession: {create},
    withHeaders: vi.fn(),
  }
  // withHeaders returns a same-shaped client; the mock is self-referential.
  platform.withHeaders.mockReturnValue(platform)

  return {
    appInfo,
    create,
    ctx: {
      data: {} as never,
      platform: platform as never,
    },
    withHeaders: platform.withHeaders,
  }
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function streamThatTimesOut(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    // Never enqueues, never closes — caller must cancel via reader.cancel().
  })
}

async function collect<T>(iter: AsyncIterable<T>, max: number = Infinity): Promise<T[]> {
  const out: T[] = []
  for await (const value of iter) {
    out.push(value)
    if (out.length >= max) break
  }

  return out
}

describe('log-session resource', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('streamLogs', () => {
    it('yields newline-delimited lines from a non-tail stream', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks([
        '2026-05-22T00:00:00Z app[web.1]: line one\n',
        '2026-05-22T00:00:01Z app[web.1]: line two\n',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app', {fetch: fetchFn as never}))

      expect(lines).toEqual([
        '2026-05-22T00:00:00Z app[web.1]: line one',
        '2026-05-22T00:00:01Z app[web.1]: line two',
      ])
    })

    it('handles a line split across two chunks', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks([
        'first half',
        ' second half\nnext\n',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app', {fetch: fetchFn as never}))

      expect(lines).toEqual(['first half second half', 'next'])
    })

    it('emits a trailing line that does not end with a newline', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks([
        'final line without newline',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app', {fetch: fetchFn as never}))

      expect(lines).toEqual(['final line without newline'])
    })

    it('forwards options to logSession.create', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks([])))

      await collect(streamLogs(ctx, 'my-app', {
        dyno: 'web.1',
        fetch: fetchFn as never,
        lines: 100,
        source: 'app',
        tail: false,
      }))

      expect(create).toHaveBeenCalledExactlyOnceWith('my-app', {
        dyno: 'web.1',
        lines: 100,
        source: 'app',
        tail: false,
      })
    })

    it('throws when the create response has no logplex_url', async () => {
      const {ctx} = buildCtx(() => ({id: 'session-1'}))
      const fetchFn = vi.fn()

      const iter = streamLogs(ctx, 'my-app', {fetch: fetchFn as never})
      await expect(iter.next()).rejects.toThrow(/did not include a logplex_url/)
    })

    it('throws when the logplex stream returns a non-2xx status', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response('bad', {status: 500}))

      const iter = streamLogs(ctx, 'my-app', {fetch: fetchFn as never})
      await expect(iter.next()).rejects.toThrow(/HTTP 500/)
    })

    it('returns immediately for non-tail streams when remote closes', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks(['only line\n'])))

      const lines = await collect(streamLogs(ctx, 'my-app', {fetch: fetchFn as never}))

      expect(create).toHaveBeenCalledTimes(1)
      expect(lines).toEqual(['only line'])
    })

    it('recreates the session when tailing and the stream stalls past sessionTimeoutMs', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      // First fetch: never emits. Second: emits one line then closes.
      // After that the loop would try to recreate again — we break the
      // iterator with .return() once we've seen the line we expect.
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatTimesOut()))
        .mockResolvedValue(new Response(streamFromChunks(['after recreate\n'])))

      const iter = streamLogs(ctx, 'my-app', {
        fetch: fetchFn as never, recreateSession: true, sessionTimeoutMs: 5, tail: true,
      })
      const lines: string[] = []
      for await (const line of iter) {
        lines.push(line)
        await iter.return()
      }

      expect(create).toHaveBeenCalledTimes(2)
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(lines).toEqual(['after recreate'])
    })

    it('does not recreate when recreateSession is false (single tail iteration)', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks(['one line\n'])))

      const lines = await collect(streamLogs(ctx, 'my-app', {fetch: fetchFn as never, recreateSession: false, tail: true}))

      expect(create).toHaveBeenCalledTimes(1)
      expect(lines).toEqual(['one line'])
    })

    it('throws AbortError when the signal is already aborted', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn()
      const controller = new AbortController()
      controller.abort()

      const iter = streamLogs(ctx, 'my-app', {fetch: fetchFn as never, signal: controller.signal})
      await expect(iter.next()).rejects.toThrow()
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('forces tail=true and uses dyno+type separately for fir-generation apps', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}), 'fir')
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks(['line\n'])))

      const iter = streamLogs(ctx, 'my-app', {
        dyno: 'web-abc-123', fetch: fetchFn as never, lines: 100, recreateSession: false, source: 'app', tail: false, type: 'web',
      })
      const lines: string[] = []
      for await (const line of iter) {
        lines.push(line)
        await iter.return()
      }

      // No `lines`, no `tail` — Fir doesn't accept those; dyno + type are sent separately.
      expect(create).toHaveBeenCalledWith('my-app', {
        dyno: 'web-abc-123',
        source: 'app',
        type: 'web',
      })
    })

    it('fires onSessionCreated once per session create with isRecreate flag', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatTimesOut()))
        .mockResolvedValue(new Response(streamFromChunks(['line\n'])))
      const onSessionCreated = vi.fn()

      const iter = streamLogs(ctx, 'my-app', {
        fetch: fetchFn as never,
        onSessionCreated,
        recreateSession: true,
        sessionTimeoutMs: 5,
        tail: true,
      })
      // Collect just the first line, then break the iterator.
      await iter.next()
      await iter.return()

      expect(onSessionCreated).toHaveBeenCalledTimes(2)
      expect(onSessionCreated.mock.calls[0][0]).toEqual({generation: 'cedar', isRecreate: false})
      expect(onSessionCreated.mock.calls[1][0]).toEqual({generation: 'cedar', isRecreate: true})
    })

    it('collapses dyno+type into a single dyno field for cedar-generation apps', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}), 'cedar')
      const fetchFn = vi.fn().mockResolvedValue(new Response(streamFromChunks([])))

      // Caller passes only `type`; Cedar expects it in the `dyno` slot.
      await collect(streamLogs(ctx, 'my-app', {
        fetch: fetchFn as never, lines: 50, source: 'app', type: 'worker',
      }))

      expect(create).toHaveBeenCalledExactlyOnceWith('my-app', {
        dyno: 'worker',
        lines: 50,
        source: 'app',
        tail: false,
      })
    })
  })

  describe('logSessionExtensions', () => {
    it('declares service: platform, resource: logSession', () => {
      expect(logSessionExtensions.service).toBe('platform')
      expect(logSessionExtensions.resource).toBe('logSession')
    })

    it('factory exposes streamLogs()', () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const methods = logSessionExtensions.factory(ctx)
      expect(typeof methods.streamLogs).toBe('function')
    })
  })
})
