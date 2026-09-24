import type {BackupCreateResult, TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/index.js'
import type {WaitForTransferOptions} from '../transfer/wait-for-transfer.js'

import {Poller} from '../../../utils/poller.js'
import {resolvePgDatabase} from '../internal/resolve-pg-database.js'
import {waitForTransfer} from '../transfer/wait-for-transfer.js'

export type CaptureAndWaitOptions = WaitForTransferOptions & {
  /**
   * Progress hooks fired once before capturing the backup `poller.onStart(addon)`
   * and once after the backup is created `poller.onStop(addon)`.
   */
  capturePoller?: Poller<ResolvedAddOn>
  /**
   * Progress hooks fired once before waiting for the transfer to
   * complete `poller.onStart(backup)` and once after the transfer
   * finishes successfully `poller.onStop(backup)`.
   */
  waitPoller?: Poller<BackupCreateResult>
}

export async function captureAndWait(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: CaptureAndWaitOptions = {},
): Promise<TransferInfoByAppResult> {
  const {capturePoller, signal, waitPoller} = options

  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})

  capturePoller?.onStart?.(addon)
  const backup = await ctx.data.backup.create(addon.id)
  capturePoller?.onStop?.(addon)

  waitPoller?.onStart?.(backup)
  const transfer = await waitForTransfer(ctx, addon.app.name, backup.uuid, options)
  waitPoller?.onStop?.(backup)

  return transfer
}
