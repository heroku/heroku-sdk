import type {RestoreCreateResult, TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/index.js'
import type {WaitForTransferOptions} from '../transfer/wait-for-transfer.js'

import {Poller} from '../../../utils/poller.js'
import {resolvePgDatabase} from '../internal/resolve-pg-database.js'
import {waitForTransfer} from '../transfer/wait-for-transfer.js'

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
  restorePoller?: Poller<ResolvedAddOn>
  /**
   * Progress hooks fired once before waiting for the restore to
   * complete `poller.onStart(restore)` and once after the restore
   * reaches a terminal state `poller.onStop(restore)`.
   */
  waitPoller?: Poller<RestoreCreateResult>
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
  const restore = await ctx.data.restore.create(addon.id, {backup_url: backupUrl, extensions})
  restorePoller?.onStop?.(addon)

  waitPoller?.onStart?.(restore)
  const transfer = await waitForTransfer(ctx, addon.app.name, restore.uuid, options)
  waitPoller?.onStop?.(restore)

  return transfer
}
