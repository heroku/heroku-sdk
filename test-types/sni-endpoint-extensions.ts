/* eslint-disable no-void */
import type {SniEndpoint} from '@heroku/types/3.sdk'

import {HerokuSDK} from '@heroku/sdk'
import {type SniCertificate, sniEndpointExtensions, type SniEndpointSelector} from '@heroku/sdk/extensions/platform'

const sdk = new HerokuSDK({extensions: [sniEndpointExtensions] as const})
const certificate: SniCertificate = {certificateChain: 'CHAIN', privateKey: 'KEY'}

// Selectors: by name, by hostname, or neither — never both.
const byName: SniEndpointSelector = {name: 'tokyo-1234'}
const byHostname: SniEndpointSelector = {hostname: 'www.example.com'}
const onlyOne: SniEndpointSelector = {}
// @ts-expect-error a selector can't name both
const both: SniEndpointSelector = {hostname: 'www.example.com', name: 'tokyo-1234'}
void [byName, byHostname, onlyOne, both]

const resolved: Promise<SniEndpoint> = sdk.platform.sniEndpoint.resolve('example-app', byName)
void resolved

sdk.platform.sniEndpoint.resolveAndDelete('example-app', byHostname, {
  beforeDelete({sniEndpoint}) {
    const {name} = sniEndpoint
    void name
  },
})

sdk.platform.sniEndpoint.resolveAndUpdate('example-app', onlyOne, certificate, {
  beforeUpdate({sniEndpoint}) {
    const {id} = sniEndpoint
    void id
  },
})

// createAndAssociate: domains, resolveDomains, or neither — never both.
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {domains: ['www.example.com']})
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {resolveDomains: async candidates => candidates})
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate)
// @ts-expect-error domains and resolveDomains are exclusive
sdk.platform.sniEndpoint.createAndAssociate('example-app', certificate, {domains: [], resolveDomains: async () => []})
// @ts-expect-error the certificate is one object, not positional strings
sdk.platform.sniEndpoint.createAndAssociate('example-app', 'CHAIN', 'KEY', {domains: []})
