/**
 * Progress hooks for a polling loop, so a caller can drive UI (e.g. a CLI
 * spinner) around each unit of work without reaching into the loop itself.
 *
 * `onStart` fires immediately before polling a unit begins; `onStop` fires
 * once it settles into a terminal state. If polling that unit throws,
 * `onStart` has already fired but `onStop` never will.
 */
export type Poller<T = void> = {
  onStart?: (arg: T) => void
  onStop?: (arg: T) => void
}
