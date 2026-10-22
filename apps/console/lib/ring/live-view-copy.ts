import { NO_VIDEO_TIMEOUT_MS, type WhepEndReason } from "@visitproof/ring-partner-sdk/whep"

/**
 * Live View copy (client safe). The "no video" case was seen live on
 * 22 October 2026: the Ring Playground doorbell negotiated H264 and Opus and
 * reached `connected`, but sent no frames. The sandbox may only stream during
 * a simulated event; that was not tested (friction log entry 18), so the copy
 * says "may".
 */

export type LiveViewSource = "playground" | "linked"

export const ENDED_TEXT: Readonly<Record<WhepEndReason, string>> = {
  cap: "Live view ended at Ring's time limit. Start it again if you need another look.",
  stopped: "Live view stopped.",
  unload: "Live view stopped.",
  no_video: "Live view stopped because no video arrived.",
}

/** Shown when Stop closed the local view but the DELETE to Ring failed. */
export const STOP_UNCONFIRMED_TEXT =
  "Live view stopped here, but Ring did not confirm the session ended. Ring closes it on its own at the time limit."

export interface NoVideoNotice {
  readonly title: string
  readonly description: string
}

const SECONDS = Math.round(NO_VIDEO_TIMEOUT_MS / 1_000)
const RELEASED = "VisitProof stopped this session so it does not hold one of Ring's live view slots."

export const noVideoNotice = (source: LiveViewSource): NoVideoNotice => ({
  title: "Connected To Ring, But No Video Arrived",
  description:
    source === "playground"
      ? `Ring accepted the live view and connected, but no video arrived within ${SECONDS} seconds. The Playground sandbox doorbell may only stream during a simulated event. You can try starting a Motion, Package, or Vehicle simulation for the Playground Device in the Ring Developer Playground, then select Start Live View again. ${RELEASED}`
      : `Ring accepted the live view and the connection was up, but the doorbell sent no video within ${SECONDS} seconds. It may be asleep, serving another live view, or on a weak Wi-Fi signal. ${RELEASED} Try again in a minute.`,
})
