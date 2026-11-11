import {
  DatabasePromotionError,
  type PromoteDatabasePartialResult,
  type PromotionMutationStatus,
} from '@heroku/sdk/extensions/data'

export function readPromotionFailure(error: unknown): [PromoteDatabasePartialResult, PromotionMutationStatus] | undefined {
  if (!(error instanceof DatabasePromotionError)) return undefined

  const {result} = error
  const {backupAttachment: backupStatus}: {backupAttachment: PromotionMutationStatus} = result.mutationStatus

  return [result, backupStatus]
}
