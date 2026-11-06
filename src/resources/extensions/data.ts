export {
  type AttachConnectionPoolingBody,
  type AttachConnectionPoolingOptions,
  type AttachConnectionPoolingResult,
  type ConnectionPoolingAttachment,
  connectionPoolingExtensions,
} from '../data/connection-pooling.js'
export {databaseCredentialExtensions} from '../data/database-credential/index.js'
export {databaseExtensions} from '../data/database.js'
export {
  type CreateLinkBody,
  type CreateLinkOptions,
  type CreateLinkResult,
  type DeleteLinkOptions,
  type DeleteLinkResult,
  InvalidLinkRemoteError,
  type LinkedDatabase,
  linkExtensions,
  type ListLinksByAppOptions,
  type PgLink,
} from '../data/link.js'
export {maintenanceExtensions} from '../data/maintenance/index.js'
export {
  EssentialDatabaseNotSupportedError,
  type LegacyDatabase,
  type ListLegacyByAppOptions,
  PgDatabaseNotFoundError,
  postgresDatabaseExtensions,
  type ResolvedPgDatabase,
} from '../data/postgres-database.js'
export {
  isCancellable,
  isRunnable,
  type Migration,
  type MigrationContext,
  type MigrationCreateBody,
  MigrationInvalidError,
  type MigrationInvalidReason,
  MigrationNotCancellableError,
  MigrationNotRunnableError,
  type MigrationOptions,
  type MigrationSource,
  type MigrationStatus,
  type MigrationTarget,
  postgresMigrationExtensions,
} from '../data/postgres-migration.js'
export {
  type AvailableLevel,
  LEADER_POOL_NAME,
  type LevelItem,
  type ListAvailableActionsOptions,
  MAX_POOL_INSTANCES,
  type PoolAction,
  postgresPoolExtensions,
} from '../data/postgres-pool.js'
export {postgresQuotaExtensions} from '../data/postgres-quota.js'
export {postgresSettingsExtensions} from '../data/postgres-settings.js'
export {
  type ForkBody,
  type ForkResult,
  postgresExtensions,
  // Aliased: the platform barrel exports an unrelated `WaitForReadyOptions`.
  type WaitForReadyOptions as PostgresWaitForReadyOptions,
  type WaitForReadyResult as PostgresWaitForReadyResult,
  type ProvisionAdvancedBody,
  type ProvisionAdvancedOptions,
  type ProvisionAdvancedResult,
  type RunUpgradeOptions,
  type RunUpgradeResult,
} from '../data/postgres.js'
export {redisExtensions} from '../data/redis/index.js'
export {type TransferSchedule, transferScheduleExtensions} from '../data/transfer-schedule.js'
export {
  backupExtensions,
  type CaptureAndWaitOptions,
  type RestoreAndWaitOptions,
  restoreExtensions,
  transferExtensions,
  TransferFailedError,
  TransferTimeoutError,
  type WaitForTransferOptions,
} from '../data/transfer/index.js'
