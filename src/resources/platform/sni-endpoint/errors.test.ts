import {describe, expect, it} from 'vitest'

import {buildSniEndpoint} from '../domain/test-utils.js'
import {
  CertificateDomainsMismatchError,
  CertificateDomainsRequiredError,
  CertificateParseError,
  SniEndpointAmbiguousError,
  SniEndpointAssociationError,
  SniEndpointNotFoundError,
} from './index.js'

// Consumers (the Heroku CLI) match these errors by `name`, not `instanceof`, so they work
// across copies of the SDK, and read the fields below to add flag hints. Renaming a
// class's `name` or one of these fields breaks them.
describe('SNI endpoint error contract', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})

  it.each([
    [new CertificateParseError(new Error('bad')), 'CertificateParseError', {id: 'invalid_certificate', statusCode: 422}],
    [new CertificateDomainsMismatchError('my-app', ['a.example.com'], []), 'CertificateDomainsMismatchError', {
      appIdentity: 'my-app', id: 'domains_mismatch', notCovered: [], notOnApp: ['a.example.com'], statusCode: 422,
    }],
    [new CertificateDomainsRequiredError('my-app', ['www.example.com']), 'CertificateDomainsRequiredError', {
      appIdentity: 'my-app', id: 'domains_required', matches: ['www.example.com'], statusCode: 422,
    }],
    [new SniEndpointAmbiguousError('my-app', [tokyo]), 'SniEndpointAmbiguousError', {
      appIdentity: 'my-app', id: 'multiple_matches', matches: [tokyo], statusCode: 422,
    }],
    [new SniEndpointNotFoundError('my-app', {name: 'nope'}, 'Not found.'), 'SniEndpointNotFoundError', {
      appIdentity: 'my-app', id: 'not_found', statusCode: 404,
    }],
    [new SniEndpointAssociationError('my-app', tokyo, new Error('Timed out.')), 'SniEndpointAssociationError', {
      appIdentity: 'my-app', id: 'association_failed', sniEndpoint: tokyo,
    }],
  ])('%s keeps its name and fields', (error, name, fields) => {
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(name)
    expect(error).toMatchObject(fields)
    expect(error.body).toMatchObject({id: fields.id, message: error.message})
  })
})
