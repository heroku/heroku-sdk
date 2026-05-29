import type {AddOn} from '@heroku/types/3.sdk'

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
 * Thrown by `createAndWait` when the Platform reports the add-on
 * settled into a non-provisioned terminal state (e.g. `deprovisioned`).
 */
export class AddonProvisioningFailedError extends Error {
  public readonly id = 'provisioning_failed'

  constructor(public readonly addon: AddOn) {
    super(`The add-on was unable to be created, with status ${addon.state}.`)
    this.name = 'AddonProvisioningFailedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}
