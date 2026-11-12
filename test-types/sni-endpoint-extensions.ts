/* eslint-disable no-void */
import type {SniEndpoint} from '@heroku/types/3.sdk'

import {HerokuSDK} from '@heroku/sdk'
import {
  type SniCertificate, sniEndpointExtensions, type SniEndpointSelector, type SniEndpointWithDomainHostnames,
} from '@heroku/sdk/extensions/platform'

const sdk = new HerokuSDK({extensions: [sniEndpointExtensions] as const})
const certificate: SniCertificate = {certificateChain: 'CHAIN', privateKey: 'KEY'}

// Selectors: by name, by hostname, or neither — never both.
const byName: SniEndpointSelector = {name: 'tokyo-1234'}
const byHostname: SniEndpointSelector = {hostname: 'www.example.com'}
const onlyOne: SniEndpointSelector = {}
// @ts-expect-error a selector can't name both
const both: SniEndpointSelector = {hostname: 'www.example.com', name: 'tokyo-1234'}
void [byName, byHostname, onlyOne, both]

const info: Promise<SniEndpoint> = sdk.platform.sniEndpoint.infoByApp('example-app', byName)
const onlyInfo: Promise<SniEndpoint> = sdk.platform.sniEndpoint.infoByApp('example-app')
// @ts-expect-error domain_hostnames is only there with includeDomainHostnames
const noHostnames: Promise<SniEndpointWithDomainHostnames> = sdk.platform.sniEndpoint.infoByApp('example-app', byName)
const withHostnames: Promise<SniEndpointWithDomainHostnames> = sdk.platform.sniEndpoint.infoByApp('example-app', byHostname, {
  includeDomainHostnames: true,
})
void [info, onlyInfo, noHostnames, withHostnames]

sdk.platform.sniEndpoint.deleteByApp('example-app', byHostname, {
  beforeDelete({sniEndpoint}) {
    const {name} = sniEndpoint
    void name
  },
})

sdk.platform.sniEndpoint.updateByApp('example-app', onlyOne, certificate, {
  beforeUpdate({sniEndpoint}) {
    const {id} = sniEndpoint
    void id
  },
})

// createAndAssociate: domains, chooseDomains, or neither — never both.
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {domains: ['www.example.com']})
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {chooseDomains: async candidates => candidates})
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate)
// @ts-expect-error domains and chooseDomains are exclusive
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {chooseDomains: async () => [], domains: []})
// @ts-expect-error the certificate is one object, not positional strings
sdk.platform.sniEndpoint.createAndAssociate('example-app', 'CHAIN', 'KEY', {domains: []})
