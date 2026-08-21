export type SpaceOptions = {
  signal?: AbortSignal
}

export type WaitForAllocatedOptions = SpaceOptions & {
  /**
   * When true, once the space reaches a terminal state, also fetches
   * the space's NAT info (`spaceNat.info`) and attaches it as `nat` on
   * the result.
   *
   * Fetching NAT info is soft-failure: if it rejects, `nat` is left
   * `undefined` on the returned space rather than failing the whole
   * wait.
   */
  includeNat?: boolean
  /**
   * Delay between polls in milliseconds.
   * Defaults to 5000 (5s)
   */
  intervalMs?: number
  /**
   * Wall-clock budget in milliseconds before `SpaceNotReadyError`
   * is thrown. Defaults to 1200000 (20 minutes)
   */
  timeoutMs?: number
}
