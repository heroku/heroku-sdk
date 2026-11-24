/* eslint-disable no-void */
import type {PipelineCoupling} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../src/core/extend-resource.js'

import {HerokuSDK} from '../src/index.js'
import {
  CouplingNotFoundError, pipelineCouplingExtensions, removeByApp, type RemoveByAppOptions,
} from '../src/resources/extensions/platform.js'

const sdk = new HerokuSDK({extensions: [pipelineCouplingExtensions] as const})
const options: RemoveByAppOptions = {signal: new AbortController().signal}
const removed: Promise<PipelineCoupling | undefined> = sdk.platform.pipelineCoupling.removeByApp('example-app', options)
const withoutOptions: Promise<PipelineCoupling | undefined> = sdk.platform.pipelineCoupling.removeByApp('example-app')
const apps = sdk.platform.pipelineCoupling.listApps('pipeline-id')
declare const ctx: Pick<ResourceCtx, 'operationSignal' | 'platform'>
const direct: Promise<PipelineCoupling | undefined> = removeByApp(ctx, 'example-app', options)
// @ts-expect-error DELETE may return no content
const required: Promise<PipelineCoupling> = sdk.platform.pipelineCoupling.removeByApp('example-app', options)
// @ts-expect-error the named helper also permits an empty DELETE result
const requiredDirect: Promise<PipelineCoupling> = removeByApp(ctx, 'example-app', options)
const error = new CouplingNotFoundError('Missing coupling', new Error('API error'))
const status: 404 = error.statusCode
void [removed, withoutOptions, apps, direct, required, requiredDirect, error.body, status]

// @ts-expect-error app identity is required
sdk.platform.pipelineCoupling.removeByApp()
// @ts-expect-error no request body or retry options
sdk.platform.pipelineCoupling.removeByApp('example-app', {retries: 1})
