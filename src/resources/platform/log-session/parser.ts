/**
 * Parsed Heroku platform log events emitted by the runtime as
 * plain-text lines on the `heroku` source. The event shapes are
 * derived from the line patterns in {@link parseHerokuLogLine}.
 *
 * Each variant has a `kind` discriminator. Consumers should
 * switch on `kind` to narrow.
 */
export type HerokuLogEvent
  = | AttachmentAttachedEvent
  | AttachmentDetachedEvent
  | AttachmentUpdatedEvent
  | ProvisioningCompletedEvent
  | ScaledToEvent
  | StartingProcessEvent
  | StateChangedEvent

export type StateChangedEvent = {
  /** Dyno or process token (e.g. `web.1` on Cedar, `web-abc-123` on Fir). */
  dynoName: string
  from: string
  kind: 'state-changed'
  /** Source token from the line prefix (e.g. `app`, `heroku`). */
  source: string
  to: string
}

export type AttachmentAttachedEvent = {
  /** Config var name the attachment was bound to (e.g. `LOGDNA`). */
  configVar: string
  kind: 'attachment-attached'
  /** Stable platform reference (e.g. `logdna-deep-31633`). */
  ref: string
}

export type AttachmentDetachedEvent = {
  configVar: string
  kind: 'attachment-detached'
  ref: string
}

export type AttachmentUpdatedEvent = {
  /** Config var that was updated (e.g. `DATABASE`). */
  configVar: string
  kind: 'attachment-updated'
  /** Add-on service name from the line bracket (e.g. `heroku-postgres`). */
  service: string
}

export type ProvisioningCompletedEvent = {
  kind: 'provisioning-completed'
  ref: string
}

/**
 * A single `Scaled to ...` line can list multiple dyno types in one
 * shot (e.g. `Scaled to web@2:Standard-1X worker@1:Standard-2X`).
 * Each entry in `entries` is one dyno type from that line.
 */
export type ScaledToEvent = {
  entries: ScaledToEntry[]
  kind: 'scaled-to'
}

export type ScaledToEntry = {
  /** Dyno type (e.g. `web`). */
  dynoType: string
  /** Resulting dyno count. */
  quantity: number
  /** Dyno size (e.g. `Standard-1X`). */
  size: string
}

export type StartingProcessEvent = {
  /** Command without surrounding backticks (e.g. `npm start`). */
  command: string
  dynoName: string
  kind: 'starting-process'
  source: string
}

// On real platform input these patterns are mutually exclusive — each
// line begins with a single verb (Attach/Detach/Update, State changed,
// Starting process, Scaled to, ...completed provisioning), so the
// order of `if` blocks in `parseHerokuLogLine` does not affect the
// outcome. Order is for readability, not correctness.
const STATE_CHANGED = /([a-zA-Z0-9-]+)\[([a-zA-Z0-9-.]+)\]: State changed from (\w+) to (\w+)/
const ATTACHMENT_UPDATED = /\[([a-zA-Z0-9-]+)\]: Update ([A-Z0-9_]+) by/
const ATTACHMENT_DETACHED = /Detach ([A-Z0-9_]+) \(@ref:([a-zA-Z0-9-]+)/
const ATTACHMENT_ATTACHED = /Attach ([A-Z0-9_]+) \(@ref:([a-zA-Z0-9-]+)/
const PROVISIONING_COMPLETED = /@ref:([a-zA-Z0-9-]+) completed provisioning/
const SCALED_TO_LINE = /\bScaled to ([a-zA-Z@:0-9_\- ]+)/
const SCALED_TO_ENTRY = /([a-zA-Z]+)@([0-9]+):([a-zA-Z0-9_-]+)/g
const STARTING_PROCESS = /([a-zA-Z0-9-]+)\[([a-zA-Z0-9-.]+)\]: Starting process with command `(.*?)`/

/**
 * Parse a single log line into a structured Heroku platform event,
 * or `undefined` if the line does not match any known event pattern.
 *
 * Pure function — no I/O, no side effects. Compose with
 * {@link streamLogs} to react to runtime events while still
 * forwarding raw lines to a UI.
 */
export function parseHerokuLogLine(line: string): HerokuLogEvent | undefined {
  const stateChanged = STATE_CHANGED.exec(line)
  if (stateChanged) {
    const [, source, dynoName, from, to] = stateChanged
    return {
      dynoName, from, kind: 'state-changed', source, to,
    }
  }

  const attachmentUpdated = ATTACHMENT_UPDATED.exec(line)
  if (attachmentUpdated) {
    const [, service, configVar] = attachmentUpdated
    return {configVar, kind: 'attachment-updated', service}
  }

  const attachmentDetached = ATTACHMENT_DETACHED.exec(line)
  if (attachmentDetached) {
    const [, configVar, ref] = attachmentDetached
    return {configVar, kind: 'attachment-detached', ref}
  }

  const attachmentAttached = ATTACHMENT_ATTACHED.exec(line)
  if (attachmentAttached) {
    const [, configVar, ref] = attachmentAttached
    return {configVar, kind: 'attachment-attached', ref}
  }

  const provisioningCompleted = PROVISIONING_COMPLETED.exec(line)
  if (provisioningCompleted) {
    return {kind: 'provisioning-completed', ref: provisioningCompleted[1]}
  }

  const scaledToLine = SCALED_TO_LINE.exec(line)
  if (scaledToLine) {
    const entries: ScaledToEntry[] = []
    for (const match of scaledToLine[1].matchAll(SCALED_TO_ENTRY)) {
      entries.push({
        dynoType: match[1],
        quantity: Number.parseInt(match[2], 10),
        size: match[3],
      })
    }

    if (entries.length > 0) {
      return {entries, kind: 'scaled-to'}
    }
  }

  const startingProcess = STARTING_PROCESS.exec(line)
  if (startingProcess) {
    const [, source, dynoName, command] = startingProcess
    return {
      command, dynoName, kind: 'starting-process', source,
    }
  }

  return undefined
}
