import type {AddOn} from '@heroku/types/3.sdk'

import {AddonAmbiguousError, AddonNotFoundError} from '../../platform/add-on/index.js'

export class RedisAddonNotFoundError extends AddonNotFoundError {
  constructor() {
    super('redis instance')
    this.message = 'No Redis instances found.'
    this.name = 'RedisAddonNotFoundError'
  }
}

export class RedisAddonAmbiguousError extends AddonAmbiguousError {
  constructor(matches: AddOn[]) {
    super(matches)
    this.message = `Please specify a single instance. Found: ${matches.map(m => m.name).join(', ')}`
    this.name = 'RedisAddonAmbiguousError'
  }
}
