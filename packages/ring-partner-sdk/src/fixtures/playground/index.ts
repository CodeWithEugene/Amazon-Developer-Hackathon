import capabilities from "./capabilities.json"
import configurations from "./configurations.json"
import devicesNoInclude from "./devices-no-include.json"
import devices from "./devices.json"
import historyEvents from "./history-events.json"
import history from "./history.json"
import location from "./location.json"
import manifest from "./manifest.json"
import me from "./me.json"
import status from "./status.json"
import subscriptions422 from "./subscriptions-422.json"

/**
 * Real Ring Playground responses (bodies only), captured live on
 * 22 October 2026 from https://api.amazonvision.com with a Playground token.
 * `manifest.json` lists every file with the request path and status code it
 * came from. Values are typed `unknown` on purpose: tests and the mock must
 * push them through the SDK schemas exactly as the live client would.
 */

export const PLAYGROUND_FIXTURES: Readonly<Record<PlaygroundFixtureName, unknown>> = {
  me,
  /** `GET /v1/devices?include=status,capabilities,configurations,location`. */
  devices,
  /** `GET /v1/devices` without include. */
  devicesNoInclude,
  status,
  capabilities,
  configurations,
  location,
  history,
  /** Live history page with 3 `on_demand` events (epoch ms `start`/`end`). */
  historyEvents,
  subscriptions422,
}

export type PlaygroundFixtureName =
  | "me"
  | "devices"
  | "devicesNoInclude"
  | "status"
  | "capabilities"
  | "configurations"
  | "location"
  | "history"
  | "historyEvents"
  | "subscriptions422"

export interface PlaygroundRequest {
  readonly method: string
  readonly path: string
  readonly status: number
}

/** The one shared Playground doorbell ("Playground Device"). */
export const PLAYGROUND_DEVICE_ID: string = manifest.deviceId

export const PLAYGROUND_MANIFEST = manifest

/** The captured request (method, path, status) behind a fixture file. */
export const playgroundRequest = (file: keyof typeof manifest.requests): PlaygroundRequest =>
  manifest.requests[file]
