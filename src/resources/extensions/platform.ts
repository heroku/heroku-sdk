export {addOnExtensions} from '../platform/add-on/index.js'
export {appExtensions, type AppInfo, type PipelineCouplingDetail} from '../platform/app/index.js'
export {
  type CreateAndWaitOptions,
  domainExtensions,
  type DomainOptions,
  type WaitForReadyOptions,
} from '../platform/domain/index.js'
export {
  dynoExtensions,
  DynoNotReadyError, type DynoState, waitForInfo, type WaitForInfoOptions,
} from '../platform/dyno/index.js'
export {
  type AttachmentAttachedEvent,
  type AttachmentDetachedEvent,
  type AttachmentUpdatedEvent,
  type HerokuLogEvent,
  logSessionExtensions,
  parseHerokuLogLine,
  type ProvisioningCompletedEvent,
  type ScaledToEntry,
  type ScaledToEvent,
  type StartingProcessEvent,
  type StateChangedEvent,
} from '../platform/log-session/index.js'
export {pipelineCouplingExtensions} from '../platform/pipeline/coupling.js'
export {pipelineExtensions} from '../platform/pipeline/index.js'
export {pipelinePromotionExtensions} from '../platform/pipeline/promotion.js'
export {privateToShield, shieldToPrivate} from '../platform/shield.js'
export {createAndAssociate, type CreateAndAssociateOptions, sniEndpointExtensions} from '../platform/sni-endpoint/index.js'
