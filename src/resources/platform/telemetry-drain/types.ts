export type TelemetryDrainOptions = {
  /**
   * Abort signal to cancel the operation.
   */
  signal?: AbortSignal
}

export type TelemetryDrainTarget = {
  app: string
  space?: never
} | {
  app?: never
  space: string
}
