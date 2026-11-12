import type {CreateAndAssociateOptions, SniCertificate} from './create-and-associate.js'
import type {
  ResolveAndDeleteOptions, ResolveAndUpdateOptions, ResolveSniEndpointOptions, SniEndpointSelector,
} from './resolve.js'

import {extendResource} from '../../../core/extend-resource.js'
import {createAndAssociate} from './create-and-associate.js'
import {resolveAndDelete, resolveAndUpdate, resolveSniEndpoint} from './resolve.js'

export {
  CertificateDomainsMismatchError,
  CertificateDomainsRequiredError,
  CertificateParseError,
} from './certificate-domains.js'
export {
  createAndAssociate,
  type CreateAndAssociateOptions,
  type SniCertificate,
  SniEndpointAssociationError,
} from './create-and-associate.js'
export {
  type ResolveAndDeleteOptions,
  type ResolveAndUpdateOptions,
  type ResolveSniEndpointOptions,
  SniEndpointAmbiguousError,
  SniEndpointNotFoundError,
  type SniEndpointSelector,
} from './resolve.js'

export const sniEndpointExtensions = extendResource('platform', 'sniEndpoint', ctx => ({
  createAndAssociate: (appIdentity: string, certificate: SniCertificate, options?: CreateAndAssociateOptions) =>
    createAndAssociate(ctx, appIdentity, certificate, options),
  resolve: (appIdentity: string, selector?: SniEndpointSelector, options?: ResolveSniEndpointOptions) =>
    resolveSniEndpoint(ctx, appIdentity, selector, options),
  resolveAndDelete: (appIdentity: string, selector: SniEndpointSelector, options?: ResolveAndDeleteOptions) =>
    resolveAndDelete(ctx, appIdentity, selector, options),
  resolveAndUpdate: (
    appIdentity: string,
    selector: SniEndpointSelector,
    certificate: SniCertificate,
    options?: ResolveAndUpdateOptions,
  ) => resolveAndUpdate(ctx, appIdentity, selector, certificate, options),
}))
