import "server-only"

import { buildDeviceChecks, type DeviceCheck } from "./device-check"
import { toRingLiveError, type RingLiveErrorCode } from "./errors"
import { getRingClient, type RingSource } from "./live"

/**
 * Page loaders for /family/devices and /family/live. They never throw: a
 * Ring failure becomes a typed, displayable error.
 */

export interface RingViewError {
  readonly code: RingLiveErrorCode
  readonly message: string
}

export type RingView<T> =
  | { readonly ok: true; readonly source: RingSource; readonly provenanceLabel: string; readonly data: T }
  | { readonly ok: false; readonly error: RingViewError }

const failure = (error: unknown, source?: RingSource): { ok: false; error: RingViewError } => {
  const live = toRingLiveError(error, source)
  return { ok: false, error: { code: live.code, message: live.message } }
}

export async function loadDeviceChecks(clientId: string | undefined): Promise<RingView<DeviceCheck[]>> {
  let source: RingSource | undefined
  try {
    const live = await getRingClient(clientId ? { clientId } : {})
    source = live.source
    const document = await live.client.devices({ include: ["status", "capabilities", "configurations", "location"] })
    return { ok: true, source: live.source, provenanceLabel: live.provenanceLabel, data: buildDeviceChecks(document) }
  } catch (error) {
    return failure(error, source)
  }
}

export interface LiveDevice {
  readonly id: string
  readonly name: string
  readonly batteryPowered: boolean | undefined
  readonly online: boolean | undefined
}

export async function loadLiveDevices(clientId: string | undefined): Promise<RingView<LiveDevice[]>> {
  let source: RingSource | undefined
  try {
    const live = await getRingClient(clientId ? { clientId } : {})
    source = live.source
    const checks = buildDeviceChecks(await live.client.devices({ include: ["status", "capabilities"] }))
    const devices = checks.map((check) => {
      const online = check.items.find((item) => item.id === "online")?.state
      return {
        id: check.deviceId,
        name: check.name,
        batteryPowered: check.batteryPowered,
        online: online === "unknown" ? undefined : online === "pass",
      }
    })
    return { ok: true, source: live.source, provenanceLabel: live.provenanceLabel, data: devices }
  } catch (error) {
    return failure(error, source)
  }
}
