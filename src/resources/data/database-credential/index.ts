import type {PostgresCredentialCreateOpts} from '@heroku/types/data'

import type {
  RotateAllDatabaseCredentialsResult,
  RotateDatabaseCredentialOptions,
  RotateDatabaseCredentialOpts,
  RotateDatabaseCredentialResult,
} from './rotate.js'

import {extendResource} from '../../../core/extend-resource.js'
import {create} from './create.js'
import {destroy} from './destroy.js'
import {getUrl} from './get-url.js'
import {list} from './list.js'
import {rotate} from './rotate.js'

export type DatabaseCredentialOptions = {
  appIdentity?: string
  signal?: AbortSignal
}

export {create, type CreateDatabaseCredentialResult} from './create.js'
export {destroy, type DestroyDatabaseCredentialResult} from './destroy.js'
export {
  type GetDatabaseCredentialUrlResult, getUrl,
} from './get-url.js'
export {list, type ListDatabaseCredentialsResult} from './list.js'
export {
  rotate,
  type RotateAllDatabaseCredentialsResult,
  type RotateDatabaseCredentialOptions,
  type RotateDatabaseCredentialOpts,
  type RotateDatabaseCredentialPreview,
  type RotateDatabaseCredentialResult,
} from './rotate.js'

export const databaseCredentialExtensions = extendResource('data', 'databaseCredential', ctx => {
  function rotateCredential(
    addonIdentity: string,
    body: RotateDatabaseCredentialOpts & {all: true},
    options?: RotateDatabaseCredentialOptions,
  ): Promise<RotateAllDatabaseCredentialsResult>
  function rotateCredential(
    addonIdentity: string,
    body?: RotateDatabaseCredentialOpts,
    options?: RotateDatabaseCredentialOptions,
  ): Promise<RotateDatabaseCredentialResult>
  function rotateCredential(
    addonIdentity: string,
    body?: RotateDatabaseCredentialOpts,
    options?: RotateDatabaseCredentialOptions,
  ): Promise<RotateAllDatabaseCredentialsResult | RotateDatabaseCredentialResult> {
    return rotate(ctx, addonIdentity, body, options)
  }

  return {
    create: (
      addonIdentity: string,
      body: PostgresCredentialCreateOpts,
      options?: DatabaseCredentialOptions,
    ) => create(ctx, addonIdentity, body, options),
    destroy: (
      addonIdentity: string,
      credName: string,
      options?: DatabaseCredentialOptions,
    ) => destroy(ctx, addonIdentity, credName, options),
    getUrl: (
      addonIdentity: string,
      credName?: string,
      options?: DatabaseCredentialOptions,
    ) => getUrl(ctx, addonIdentity, credName, options),
    list: (
      addonIdentity: string,
      options?: DatabaseCredentialOptions,
    ) => list(ctx, addonIdentity, options),
    rotate: rotateCredential,
  }
})
