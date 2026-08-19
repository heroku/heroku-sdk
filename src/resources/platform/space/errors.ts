import type {Space} from '@heroku/types/3.sdk'

/**
 * Thrown by `waitForAllocated` when the space settles into a terminal
 * state other than `allocated` (e.g. `deleting`).
 */
export class SpaceNotAllocatedError extends Error {
  public readonly id = 'space_not_allocated'

  constructor(public readonly space: Space) {
    super(`The space ${space.name} did not become allocated, with state ${space.state}.`)
    this.name = 'SpaceNotAllocatedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `waitForAllocated` when `timeoutMs` elapses while the space
 * is still `allocating`.
 */
export class SpaceNotReadyError extends Error {
  public readonly id = 'space_not_ready'

  constructor(
    public readonly space: Space,
    public readonly timeoutMs: number,
  ) {
    super(`Timeout waiting for space ${space.name} to become allocated.`)
    this.name = 'SpaceNotReadyError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}
