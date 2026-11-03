import type {AddOn} from '@heroku/types/3.sdk'

import type {DeprovisioningAddOn, ResolvedAddOn} from './types.js'

export class AddonNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly statusCode = 404

  constructor(public readonly resource: string = 'addon') {
    super(`Couldn't find that ${resource}.`)
    this.name = 'AddonNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: this.resource}
  }
}

export class AddonAmbiguousError extends Error {
  public readonly id = 'multiple_matches'
  public readonly statusCode = 422

  constructor(public readonly matches: AddOn[]) {
    super(`Ambiguous identifier; multiple matching add-ons found: ${matches.map(m => m.name).join(', ')}.`)
    this.name = 'AddonAmbiguousError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `createAndWait` when the Platform returns 423
 * `confirmation_required`. Callers that want to prompt the user should
 * catch this, gather a confirmation value, and retry the call with
 * `body.confirm` set.
 */
export class AddonConfirmationRequiredError extends Error {
  public readonly id = 'confirmation_required'
  public readonly statusCode = 423

  constructor(public readonly platformMessage: string) {
    super(platformMessage)
    this.name = 'AddonConfirmationRequiredError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `postgresDatabase.destroy` when the database can't be found under
 * the requested app but does exist under another app. Restores the CLI's
 * historical "is on <app> not <app>" guidance so a database scoped to the
 * wrong app surfaces a targeted error rather than a bare not-found.
 */
export class AddonAppMismatchError extends Error {
  public readonly id = 'app_mismatch'

  constructor(public readonly addon: ResolvedAddOn, public readonly requestedApp: string) {
    super(`Database ${addon.name} is on ${addon.app.name} not ${requestedApp}. Try again with the correct app.`)
    this.name = 'AddonAppMismatchError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `postgresDatabase.destroy` when the delete request (or its
 * deprovisioning wait) fails after the database was resolved and any
 * `beforeDestroy` confirmation passed. Carries the resolved add-on so callers
 * can render tier-specific guidance without re-resolving; the underlying
 * failure is preserved as the standard `cause`.
 */
export class AddonDestroyFailedError extends Error {
  public readonly id = 'destroy_failed'

  constructor(public readonly addon: ResolvedAddOn, cause: unknown) {
    super(messageFromCause(cause), {cause})
    this.name = 'AddonDestroyFailedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

function messageFromCause(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    const {body} = cause as {body?: {message?: string}}
    if (body?.message) {
      return body.message
    }

    const {message} = cause as {message?: string}
    if (message) {
      return message
    }
  }

  return String(cause)
}

/**
 * Thrown by `createAndWait` when the Platform reports the add-on
 * settled into a non-provisioned terminal state (e.g. `deprovisioned`).
 */
export class AddonProvisioningFailedError extends Error {
  public readonly id = 'provisioning_failed'

  constructor(public readonly addon: AddOn | DeprovisioningAddOn) {
    super(`The add-on was unable to be created, with status ${addon.state}.`)
    this.name = 'AddonProvisioningFailedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}
