/**
 * Live View state rules kept out of the component so they can be tested.
 * `WhepPeer.start()` resolves normally when Stop ran while it was still
 * negotiating or signaling, so the component must not assume "live" then.
 */

export interface StartResult {
  /** The peer that just started is still the one the component holds. */
  readonly isCurrent: boolean
  /** The WHEP session URL the peer holds after start, if any. */
  readonly sessionUrl: string | undefined
}

export type StartOutcome = "live" | "cancelled"

export const startOutcome = ({ isCurrent, sessionUrl }: StartResult): StartOutcome =>
  isCurrent && sessionUrl !== undefined ? "live" : "cancelled"
