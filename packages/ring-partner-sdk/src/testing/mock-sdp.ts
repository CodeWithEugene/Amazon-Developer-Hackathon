/**
 * A syntactically valid WHEP SDP answer for the mock Playground. It mirrors
 * the offer's media sections (sendonly, one codec each: H264 for video and
 * Opus for audio, as Ring negotiated live on 22 October 2026) but carries no
 * ICE candidates, so a browser accepts the answer and never connects. That
 * is enough to exercise signaling, the session cap, and the DELETE.
 */

interface OfferSection {
  readonly kind: string
  readonly proto: string
  readonly mid: string
  readonly payloads: readonly string[]
  readonly attributes: readonly string[]
}

const PREFERRED_CODEC: Readonly<Record<string, string>> = { video: "H264", audio: "opus" }
const MOCK_FINGERPRINT = Array.from({ length: 32 }, (_, index) => (index * 7 + 16).toString(16).toUpperCase().padStart(2, "0")).join(":")

const splitSections = (offer: string): readonly (readonly string[])[] => {
  const lines = offer.split(/\r?\n/).filter((line) => line.length > 0)
  const starts = lines.flatMap((line, index) => (line.startsWith("m=") ? [index] : []))
  return starts.map((start, position) => lines.slice(start, starts[position + 1] ?? lines.length))
}

const parseSection = (lines: readonly string[], index: number): OfferSection => {
  const [kindPart = "m=video", , proto = "UDP/TLS/RTP/SAVPF", ...payloads] = (lines[0] ?? "").split(" ")
  const mid = lines.find((line) => line.startsWith("a=mid:"))?.slice("a=mid:".length) ?? String(index)
  return { kind: kindPart.slice(2), proto, mid, payloads, attributes: lines.slice(1) }
}

const choosePayload = (section: OfferSection): string | undefined => {
  const codec = PREFERRED_CODEC[section.kind]?.toLowerCase()
  const match = section.attributes.find((line) => {
    const rtpmap = /^a=rtpmap:(\d+) ([^/]+)\//.exec(line)
    return rtpmap !== null && rtpmap[2]?.toLowerCase() === codec
  })
  return match ? /^a=rtpmap:(\d+)/.exec(match)?.[1] : section.payloads[0]
}

const answerSection = (section: OfferSection): readonly string[] => {
  const payload = choosePayload(section)
  const codecLines = payload
    ? section.attributes.filter((line) => line.startsWith(`a=rtpmap:${payload} `) || line.startsWith(`a=fmtp:${payload} `))
    : []
  return [
    `m=${section.kind} 9 ${section.proto} ${payload ?? "0"}`,
    "c=IN IP4 0.0.0.0",
    `a=mid:${section.mid}`,
    "a=sendonly",
    "a=rtcp-mux",
    "a=ice-ufrag:mock",
    "a=ice-pwd:mockplaygroundicepassword00",
    `a=fingerprint:sha-256 ${MOCK_FINGERPRINT}`,
    "a=setup:active",
    ...codecLines,
  ]
}

/** Builds an SDP answer that mirrors the offer's media sections. */
export const buildMockSdpAnswer = (offer: string, sessionId = "1"): string => {
  const sections = splitSections(offer).map(parseSection)
  const lines = [
    "v=0",
    `o=- ${sessionId.replace(/\D/g, "").slice(0, 18) || "1"} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    ...(sections.length ? [`a=group:BUNDLE ${sections.map((section) => section.mid).join(" ")}`] : []),
    ...sections.flatMap(answerSection),
  ]
  return `${lines.join("\r\n")}\r\n`
}
