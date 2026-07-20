import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {logSessionExtensions, streamLogs} from './index.js'

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: vi.fn(),
}))

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

function streamThatErrors(message: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.error(new Error(message))
    },
  })
}

function sseResponse(chunks: string[]): Response {
  return new Response(streamFromChunks(chunks), {
    headers: {'content-type': 'text/event-stream'},
  })
}

/**
 * Wire HerokuApiClient's mock so that constructing one and calling
 * .stream() returns the next response from the supplied list. Each
 * call yields a fresh response; if the list is exhausted, falls back
 * to the last value.
 */
function mockStream(...responses: Response[]): ReturnType<typeof vi.fn> {
  const stream = vi.fn()
  for (const response of responses) {
    stream.mockResolvedValueOnce(response)
  }

  vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
    this.stream = stream
  } as never)
  return stream
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
      mockStream(new Response(streamFromChunks([
        '2026-05-22T00:00:00Z app[web.1]: line one\n',
        '2026-05-22T00:00:01Z app[web.1]: line two\n',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual([
        '2026-05-22T00:00:00Z app[web.1]: line one',
        '2026-05-22T00:00:01Z app[web.1]: line two',
      ])
    })

    it('handles a line split across two chunks', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamFromChunks([
        'first half',
        ' second half\nnext\n',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['first half second half', 'next'])
    })

    it('emits a trailing line that does not end with a newline', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamFromChunks([
        'final line without newline',
      ])))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['final line without newline'])
    })

    it('forwards options to logSession.create', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamFromChunks([])))

      await collect(streamLogs(ctx, 'my-app', {
        dyno: 'web.1',
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

      const iter = streamLogs(ctx, 'my-app')
      await expect(iter.next()).rejects.toThrow(/did not include a logplex_url/)
    })

    it('returns immediately for non-tail streams when remote closes', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamFromChunks(['only line\n'])))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(create).toHaveBeenCalledTimes(1)
      expect(lines).toEqual(['only line'])
    })

    it('recreates the session when tailing and the stream stalls past sessionTimeoutMs', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const stream = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatTimesOut()))
        .mockResolvedValue(new Response(streamFromChunks(['after recreate\n'])))
      vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
        this.stream = stream
      } as never)

      const iter = streamLogs(ctx, 'my-app', {
        recreateSession: true, sessionTimeoutMs: 5, tail: true,
      })
      const lines: string[] = []
      for await (const line of iter) {
        lines.push(line)
        await iter.return()
      }

      expect(create).toHaveBeenCalledTimes(2)
      expect(stream).toHaveBeenCalledTimes(2)
      expect(lines).toEqual(['after recreate'])
    })

    // Tests below use `retryBaseDelayMs: 1, maxRetryDelayMs: 1` so
    // exponential backoff doesn't make the suite slow.
    const FAST_RETRY = {maxRetryDelayMs: 1, retryBaseDelayMs: 1} as const

    it('recreates the session on transport error when tailing', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const stream = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatErrors('terminated')))
        .mockResolvedValue(new Response(streamFromChunks(['after reconnect\n'])))
      vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
        this.stream = stream
      } as never)

      const iter = streamLogs(ctx, 'my-app', {...FAST_RETRY, recreateSession: true, tail: true})
      const lines: string[] = []
      for await (const line of iter) {
        lines.push(line)
        await iter.return()
      }

      expect(create).toHaveBeenCalledTimes(2)
      expect(lines).toEqual(['after reconnect'])
    })

    it('gives up after maxConsecutiveTransportErrors with no successful yield', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      const stream = vi.fn()
        .mockResolvedValue(new Response(streamThatErrors('terminated')))
      vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
        this.stream = stream
      } as never)

      const iter = streamLogs(ctx, 'my-app', {...FAST_RETRY, recreateSession: true, tail: true})
      await expect(collect(iter)).rejects.toThrow(/terminated/)
      // 1 initial + 5 retries.
      expect(create).toHaveBeenCalledTimes(6)
    })

    it('resets the consecutive-error counter after a successful yield', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      // Pattern: 4 errors, one good, then 5 more errors. Without the
      // reset on yield this would give up; with the reset it survives
      // the second burst (4 + 1 + 5 attempts, with retry allowed since
      // we yielded between). The 5th error in the second burst hits
      // MAX and we throw.
      const stream = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatErrors('blip 1')))
        .mockResolvedValueOnce(new Response(streamThatErrors('blip 2')))
        .mockResolvedValueOnce(new Response(streamThatErrors('blip 3')))
        .mockResolvedValueOnce(new Response(streamThatErrors('blip 4')))
        .mockResolvedValueOnce(new Response(streamFromChunks(['recovered\n'])))
        .mockResolvedValue(new Response(streamThatErrors('blip again')))
      vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
        this.stream = stream
      } as never)

      const iter = streamLogs(ctx, 'my-app', {...FAST_RETRY, recreateSession: true, tail: true})
      const collected: string[] = []
      await expect((async () => {
        for await (const line of iter) collected.push(line)
      })()).rejects.toThrow(/blip again/)

      expect(collected).toEqual(['recovered'])
      // 4 errors (counter 1..4, all under MAX) + 1 success (counter
      // resets to 0) + 5 retries (counter 1..5, last one bumps to 5
      // then on the 6th error the check fails and we throw) = 11
      // create calls.
      expect(create).toHaveBeenCalledTimes(11)
    })

    it('does not retry transport errors when recreateSession is false', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamThatErrors('terminated')))

      const iter = streamLogs(ctx, 'my-app', {recreateSession: false, tail: true})
      await expect(collect(iter)).rejects.toThrow(/terminated/)
    })

    it('aborts mid-backoff without throwing extra recreate attempts', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(
        new Response(streamThatErrors('terminated')),
        new Response(streamFromChunks(['never reached\n'])),
      )
      const controller = new AbortController()

      const iter = streamLogs(ctx, 'my-app', {
        // 100ms backoff gives us time to abort between attempts.
        maxRetryDelayMs: 100,
        recreateSession: true,
        retryBaseDelayMs: 100,
        signal: controller.signal,
        tail: true,
      })
      const next = iter.next()
      // Abort during the backoff window between the first error and
      // the recreate attempt.
      setTimeout(() => controller.abort(), 30)
      await expect(next).rejects.toThrow()
      // Only the initial create succeeded; no retry started.
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('does not recreate when recreateSession is false (single tail iteration)', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(new Response(streamFromChunks(['one line\n'])))

      const lines = await collect(streamLogs(ctx, 'my-app', {recreateSession: false, tail: true}))

      expect(create).toHaveBeenCalledTimes(1)
      expect(lines).toEqual(['one line'])
    })

    it('throws AbortError when the signal is already aborted', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const controller = new AbortController()
      controller.abort()

      const iter = streamLogs(ctx, 'my-app', {signal: controller.signal})
      await expect(iter.next()).rejects.toThrow()
      expect(HerokuApiClient).not.toHaveBeenCalled()
    })

    it('forces tail=true and uses dyno+type separately for fir-generation apps', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}), 'fir')
      mockStream(new Response(streamFromChunks(['line\n'])))

      const iter = streamLogs(ctx, 'my-app', {
        dyno: 'web-abc-123', lines: 100, recreateSession: false, source: 'app', tail: false, type: 'web',
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
      const stream = vi.fn()
        .mockResolvedValueOnce(new Response(streamThatTimesOut()))
        .mockResolvedValue(new Response(streamFromChunks(['line\n'])))
      vi.mocked(HerokuApiClient).mockImplementation(function (this: {stream: typeof stream}) {
        this.stream = stream
      } as never)
      const onSessionCreated = vi.fn()

      const iter = streamLogs(ctx, 'my-app', {
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

    it('requests text/event-stream so Fir\'s telemetry-proxy sends framed records', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const stream = mockStream(new Response(streamFromChunks([])))

      await collect(streamLogs(ctx, 'my-app'))

      expect(stream).toHaveBeenCalledWith(expect.any(String), {
        headers: {Accept: 'text/event-stream'},
      })
    })

    it('yields decoded data lines when the response is text/event-stream', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        'id: 1\ndata: line one\n\n',
        'id: 2\ndata: line two\n\n',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['line one', 'line two'])
    })

    it('buffers an SSE frame split across chunks until the blank-line boundary arrives', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        'id: 1\ndata: hel',
        'lo world\n\nid: 2\ndata: next\n\n',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['hello world', 'next'])
    })

    it('joins multiple data: fields within one SSE event with a newline', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        'data: first\ndata: second\n\n',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['first\nsecond'])
    })

    it('ignores SSE comment lines and non-data fields', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        ':heartbeat\nevent: ping\nid: 42\ndata: only this\n\n',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['only this'])
    })

    it('strips a single leading space from an SSE data value', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        'data:  padded\n\n',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      // One leading space is stripped per spec; a second space is preserved.
      expect(lines).toEqual([' padded'])
    })

    it('does not flush a trailing unterminated SSE frame', async () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      mockStream(sseResponse([
        'data: complete\n\ndata: incomplete',
      ]))

      const lines = await collect(streamLogs(ctx, 'my-app'))

      expect(lines).toEqual(['complete'])
    })

    it('collapses dyno+type into a single dyno field for cedar-generation apps', async () => {
      const {create, ctx} = buildCtx(() => ({...SESSION_BASE}), 'cedar')
      mockStream(new Response(streamFromChunks([])))

      // Caller passes only `type`; Cedar expects it in the `dyno` slot.
      await collect(streamLogs(ctx, 'my-app', {lines: 50, source: 'app', type: 'worker'}))

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

    it('factory exposes parseHerokuLogLine()', () => {
      const {ctx} = buildCtx(() => ({...SESSION_BASE}))
      const methods = logSessionExtensions.factory(ctx)
      expect(methods.parseHerokuLogLine('heroku[web.1]: State changed from up to down'))
        .toEqual({
          dynoName: 'web.1', from: 'up', kind: 'state-changed', source: 'heroku', to: 'down',
        })
    })
  })
})
