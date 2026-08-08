import type {AppTransfer, TeamApp} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

export type TransferOptions = {
  personalToPersonal?: boolean
  signal?: AbortSignal
  silent?: boolean
}

/**
 * Transfer an app to another user or team.
 *
 * Route selection mirrors the platform's two transfer surfaces:
 *   - personal-to-personal transfers go through `POST /account/app-transfers`
 *     (`appTransfer.create`), which emails the recipient for acceptance
 *     (response `state: 'pending'`).
 *   - team-involved transfers go through `PATCH /teams/apps/{name}`
 *     (`teamApp.transferToTeam` / `transferToAccount`), differing only by body.
 *
 * The caller (CLI) decides `personalToPersonal` and interprets the returned
 * `state` for presentation.
 */
export async function transferApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  recipient: string,
  options: TransferOptions = {},
): Promise<AppTransfer | TeamApp> {
  options.signal?.throwIfAborted()

  // Thread the caller's AbortSignal into every HTTP request so an abort
  // cancels the in-flight transfer, not just the pre-flight check above.
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  if (options.personalToPersonal) {
    const body: {app: string; recipient: string; silent?: boolean} = {app: appIdentity, recipient}
    if (options.silent !== undefined) body.silent = options.silent
    return platform.appTransfer.create(body)
  }

  // Team-involved (personalToPersonal=false): both routes are PATCH /teams/apps/{name}
  // with body {owner}, differing only by semantics. Per the ticket's explicit
  // enumeration (teamApp.transferToAccount / transferToTeam), split by recipient
  // shape: an email recipient transfers ownership to a personal ACCOUNT; anything
  // else is a TEAM name. Both produce a byte-identical wire request to the legacy
  // app-transfer.ts (which collapsed to one PATCH with {owner: recipient}), so
  // this is a spec-faithful split with no functional regression.
  const looksLikeEmail = recipient.includes('@')
  return looksLikeEmail
    ? platform.teamApp.transferToAccount(appIdentity, {owner: recipient})
    : platform.teamApp.transferToTeam(appIdentity, {owner: recipient})
}
