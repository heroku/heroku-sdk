/* eslint-disable no-await-in-loop -- polling is inherently sequential */
import type {Dyno, Release} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'

const DEFAULT_DELAY_MS = 10_000
const LATEST_RELEASE_RANGE = 'version ..; max=1, order=desc'

/**
 * Progress reported on each poll where the fleet has NOT yet fully
 * converged on the target release. `onLatest` of `total` relevant
 * dynos are running a version `>= version`.
 */
export type WaitForReleaseProgress = {
  onLatest: number
  total: number
  version: number
}

export type WaitForReleaseOptions = {
  /** Delay between polls in milliseconds. Defaults to 10000. */
  delayMs?: number
  /**
   * Fires after every poll where the fleet has NOT yet converged
   * (i.e. `onLatest < total`), before the next wait. It never fires
   * on the converged poll — a fleet already on the latest release
   * when the first poll runs produces no `onPoll` calls at all. Use
   * it to drive a live progress indicator; the converged result is
   * the resolved value, not an `onPoll` call.
   */
  onPoll?: (progress: WaitForReleaseProgress) => void
  signal?: AbortSignal
  /** Only wait for dynos of this process type. */
  type?: string
  /** Include one-off `run` dynos in the wait. Mutually exclusive with `type`. */
  withRun?: boolean
}

export type WaitForReleaseResult = {
  total: number
  version: number
}

/**
 * Poll an app's dynos until every relevant one is `up` and running a
 * release version at least the app's latest, then resolve with the
 * converged `{total, version}`.
 *
 * "Relevant" excludes `release` dynos always, and one-off `run` dynos
 * unless {@link WaitForReleaseOptions.withRun} is set; when
 * {@link WaitForReleaseOptions.type} is given, only that process type
 * is considered.
 *
 * The latest release is resolved once up front via
 * `GET /apps/{app}/releases` scoped to `Range: version ..; max=1,
 * order=desc`. If the app has no releases (or the latest has no
 * version), resolves `undefined` without polling — the caller should
 * report "no releases" rather than wait forever.
 */
export async function waitForRelease(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: WaitForReleaseOptions = {},
): Promise<WaitForReleaseResult | undefined> {
  const {
    delayMs = DEFAULT_DELAY_MS, onPoll, signal, type, withRun,
  } = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  const releases = await platform
    .withHeaders({Range: LATEST_RELEASE_RANGE})
    .release.list(appIdentity) as Release[]

  const version = releases[0]?.version
  if (version === undefined) {
    return undefined
  }

  while (true) {
    const dynos = await platform.dyno.list(appIdentity) as Dyno[]
    const relevant = dynos
      .filter(dyno => dyno.type !== 'release')
      .filter(dyno => withRun || dyno.type !== 'run')
      .filter(dyno => !type || dyno.type === type)

    const onLatest = relevant.filter(dyno => (
      dyno.state === 'up'
      && dyno.release?.version !== undefined
      && dyno.release.version >= version
    )).length

    if (onLatest === relevant.length) {
      return {total: relevant.length, version}
    }

    onPoll?.({onLatest, total: relevant.length, version})

    await wait(delayMs, signal)
  }
}
