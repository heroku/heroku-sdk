import type {AppTransfer, TeamApp} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

/**
 * Options for a personal-to-personal transfer (`POST /account/app-transfers`).
 * `silent` only applies to this surface, so it lives here and not on the team
 * variant.
 */
export type PersonalTransferOptions = {personalToPersonal: true; signal?: AbortSignal; silent?: boolean}

/**
 * Options for a team-involved transfer (`PATCH /teams/apps/{name}`).
 */
export type TeamTransferOptions = {personalToPersonal: false; signal?: AbortSignal}

/**
 * Discriminated union of transfer options. The `personalToPersonal`
 * discriminant is required — the caller must state which surface to use.
 */
export type TransferOptions = PersonalTransferOptions | TeamTransferOptions

/**
 * The ctx-less, overloaded call signature the extension wrapper is typed with:
 * `personalToPersonal: true` yields an `AppTransfer`, `false` yields a `TeamApp`.
 */
export type TransferFn = {
  (appIdentity: string, recipient: string, options: PersonalTransferOptions): Promise<AppTransfer>
  (appIdentity: string, recipient: string, options: TeamTransferOptions): Promise<TeamApp>
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
 * `personalToPersonal` is required: the caller must determine the source app's
 * owner and state which surface to use. There is no default — a team-owned app
 * routed through the personal surface would be incorrect.
 */
export function transferApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  recipient: string,
  options: PersonalTransferOptions,
): Promise<AppTransfer>
export function transferApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  recipient: string,
  options: TeamTransferOptions,
): Promise<TeamApp>
export async function transferApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  recipient: string,
  options: TransferOptions,
): Promise<AppTransfer | TeamApp> {
  options.signal?.throwIfAborted()

  // Thread the caller's AbortSignal into every HTTP request so an abort
  // cancels the in-flight transfer, not just the pre-flight check above.
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  const {personalToPersonal} = options

  if (personalToPersonal) {
    const body: {app: string; recipient: string; silent?: boolean} = {app: appIdentity, recipient}
    // `silent` is only present on PersonalTransferOptions; narrowing via the
    // discriminant above makes `options.silent` accessible here.
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
