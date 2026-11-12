import type {MatchCertificateDomainsOptions} from './certificate-domains.js'
import type {CreateAndAssociateOptions} from './create-and-associate.js'
import type {
  ResolveAndDeleteOptions, ResolveAndUpdateOptions, ResolveSniEndpointOptions, SniEndpointSelector,
} from './resolve.js'

import {extendResource} from '../../../core/extend-resource.js'
import {matchCertificateDomains} from './certificate-domains.js'
import {createAndAssociate} from './create-and-associate.js'
import {resolveAndDelete, resolveAndUpdate, resolveSniEndpoint} from './resolve.js'

export {
  CertificateDomainsMismatchError,
  matchCertificateDomains,
  type MatchCertificateDomainsOptions,
} from './certificate-domains.js'
export {createAndAssociate, type CreateAndAssociateOptions, SniEndpointAssociationError} from './create-and-associate.js'
export {
  type ResolveAndDeleteOptions,
  type ResolveAndUpdateOptions,
  type ResolveSniEndpointOptions,
  SniEndpointAmbiguousError,
  SniEndpointNotFoundError,
  type SniEndpointSelector,
} from './resolve.js'

export const sniEndpointExtensions = extendResource('platform', 'sniEndpoint', ctx => ({
  createAndAssociate: (
    appIdentity: string,
    certificateChain: string,
    privateKey: string,
    options: CreateAndAssociateOptions,
  ) => createAndAssociate(ctx, appIdentity, certificateChain, privateKey, options),
  matchCertificateDomains: (
    appIdentity: string,
    certificateChain: string,
    options?: MatchCertificateDomainsOptions,
  ) => matchCertificateDomains(ctx, appIdentity, certificateChain, options),
  resolve: (appIdentity: string, selector?: SniEndpointSelector, options?: ResolveSniEndpointOptions) =>
    resolveSniEndpoint(ctx, appIdentity, selector, options),
  resolveAndDelete: (appIdentity: string, selector: SniEndpointSelector, options?: ResolveAndDeleteOptions) =>
    resolveAndDelete(ctx, appIdentity, selector, options),
  resolveAndUpdate: (
    appIdentity: string,
    selector: SniEndpointSelector,
    certificate: {certificate_chain: string; private_key: string},
    options?: ResolveAndUpdateOptions,
  ) => resolveAndUpdate(ctx, appIdentity, selector, certificate, options),
}))
