import type {AddOn, AddOnAttachment} from '@heroku/types/3.sdk'

export type AddOnOptions = {
  signal?: AbortSignal
}

export type ResolveAddonOptions = AddOnOptions & {
  addonService?: string
  appIdentity?: string
}

/**
 * An add-on whose `app.id` and `id` are guaranteed non-null. This is what
 * the Platform's resolver returns for a successful match, but the schema
 * types both as optional. `singularize` enforces it at runtime so callers
 * can rely on the narrower type.
 */
export type ResolvedAddOn = AddOn & {
  app: AddOn['app'] & {id: string}
  id: string
}

export type DescribedAddOn = ResolvedAddOn & {
  attachments: AddOnAttachment[]
}

export type UpgradeAddOnOptions = ResolveAddonOptions & {
  onResolved?: (addon: ResolvedAddOn) => Promise<void> | void
}

export type CreateAndWaitOptions = {
  /**
   * Fires once after the initial create returns and the add-on is
   * still provisioning, before the first poll. Receives the create
   * response. Useful for surfacing two-phase UX: e.g. "Creating
   * <plan>... <price>" followed by "Waiting for <addonName>...".
   *
   * Only invoked when `wait: true` and the create response state is
   * `provisioning`.
   */
  onProvisioning?: (addon: AddOn) => Promise<void> | void
  /**
   * If true, poll until the add-on leaves the `provisioning` state. If
   * the final state is anything other than `provisioned`/`provisioning`
   * (e.g. `deprovisioned`), throws `AddonProvisioningFailedError`.
   *
   * If false (the default), returns immediately after the create call —
   * even if the add-on is still provisioning.
   */
  wait?: boolean
  /** Polling interval in milliseconds. Defaults to 5000. */
  waitIntervalMs?: number
} & AddOnOptions
