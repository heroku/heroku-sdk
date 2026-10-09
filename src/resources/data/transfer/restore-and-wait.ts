import type {TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedPgDatabase} from '../internal/resolve-pg-database.js'
import type {WaitForTransferOptions} from './wait-for-transfer.js'

import {Poller} from '../../../utils/poller.js'
import {resolvePgDatabase} from '../internal/resolve-pg-database.js'
import {waitForTransfer} from './wait-for-transfer.js'

/**
 * `data.restore.create`'s declared return type, `RestoreCreateResult`, only
 * lists `uuid`/`from_type`/`to_type`, but the actual response includes the
 * full transfer record. Widen the type here so callers (e.g. `waitPoller`) can
 * use the full transfer record.
 */
export type RestoreCreateInfo = TransferInfoByAppResult

export type RestoreAndWaitOptions = WaitForTransferOptions & {
  /**
   * Extension names to preinstall on the restore target.
   */
  extensions?: string[]
  /**
   * Progress hooks fired once before creating the restore
   * `poller.onStart(addon)` and once after the restore is
   * created `poller.onStop(addon)`.
   */
  restorePoller?: Poller<ResolvedPgDatabase>
  /**
   * Progress hooks fired once before waiting for the restore to
   * complete `poller.onStart(restore)` and once after the restore
   * reaches a terminal state `poller.onStop(restore)`.
   */
  waitPoller?: Poller<RestoreCreateInfo>
}

export async function restoreAndWait(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity: string | undefined,
  backupUrl: string,
  options: RestoreAndWaitOptions = {},
): Promise<TransferInfoByAppResult> {
  const {extensions, restorePoller, signal, waitPoller} = options

  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})

  restorePoller?.onStart?.(addon)
  // eslint-disable-next-line camelcase
  const restore = await ctx.data.restore.create(addon.id, {backup_url: backupUrl, extensions}) as RestoreCreateInfo
  restorePoller?.onStop?.(addon)

  waitPoller?.onStart?.(restore)
  const transfer = await waitForTransfer(ctx, addon.app.name, restore.uuid, options)
  waitPoller?.onStop?.(restore)

  return transfer
}
