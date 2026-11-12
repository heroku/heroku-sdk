import type {SniEndpoint} from '@heroku/types/3.sdk'

import type {
  SniEndpointDeleteByAppOptions,
  SniEndpointInfoByAppOptions,
  SniEndpointSelector,
  SniEndpointUpdateByAppOptions,
  SniEndpointWithDomainHostnames,
} from './by-app.js'
import type {CreateAndAssociateOptions, SniCertificate} from './create-and-associate.js'

import {extendResource} from '../../../core/extend-resource.js'
import {deleteByApp, infoByApp, updateByApp} from './by-app.js'
import {createAndAssociate} from './create-and-associate.js'

export {
  SniEndpointAmbiguousError,
  type SniEndpointDeleteByAppOptions,
  type SniEndpointInfoByAppOptions,
  SniEndpointNotFoundError,
  type SniEndpointSelector,
  type SniEndpointUpdateByAppOptions,
  type SniEndpointWithDomainHostnames,
} from './by-app.js'
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

/** `infoByApp`'s signature, without the resource context. */
type InfoByApp = {
  (
    appIdentity: string,
    selector: SniEndpointSelector | undefined,
    options: SniEndpointInfoByAppOptions & {includeDomainHostnames: true},
  ): Promise<SniEndpointWithDomainHostnames>
  (appIdentity: string, selector?: SniEndpointSelector, options?: SniEndpointInfoByAppOptions): Promise<SniEndpoint>
}

export const sniEndpointExtensions = extendResource('platform', 'sniEndpoint', ctx => ({
  createAndAssociate: (appIdentity: string, certificate: SniCertificate, options?: CreateAndAssociateOptions) =>
    createAndAssociate(ctx, appIdentity, certificate, options),
  deleteByApp: (appIdentity: string, selector: SniEndpointSelector, options?: SniEndpointDeleteByAppOptions) =>
    deleteByApp(ctx, appIdentity, selector, options),
  infoByApp: ((appIdentity: string, selector?: SniEndpointSelector, options?: SniEndpointInfoByAppOptions) =>
    infoByApp(ctx, appIdentity, selector, options)) as InfoByApp,
  updateByApp: (
    appIdentity: string,
    selector: SniEndpointSelector,
    certificate: SniCertificate,
    options?: SniEndpointUpdateByAppOptions,
  ) => updateByApp(ctx, appIdentity, selector, certificate, options),
}))
