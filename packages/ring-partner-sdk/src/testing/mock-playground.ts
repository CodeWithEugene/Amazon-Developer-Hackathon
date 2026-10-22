import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { CONTENT_TYPES, ENDPOINTS, HEADERS } from "../endpoints"
import { PLAYGROUND_DEVICE_ID, PLAYGROUND_FIXTURES, type PlaygroundFixtureName } from "../fixtures/playground"
import { deviceListDocumentSchema } from "../types"
import { buildMockSdpAnswer } from "./mock-sdp"

/**
 * Mock Ring Playground: a local stand in for https://api.amazonvision.com
 * that serves the REAL responses captured on 22 October 2026
 * (src/fixtures/playground/). Point the console's RING_API_BASE at it to run
 * live mode without a Playground token:
 *
 *   pnpm --filter @visitproof/ring-partner-sdk mock:playground      # http://127.0.0.1:3271
 *   pnpm --filter @visitproof/ring-partner-sdk mock:playground -- --port=3275
 *
 * Serves users/me, devices (with or without include), one device, the four
 * device sub-resources, history (an empty page, as the sandbox returned),
 * subscriptions (422, as the sandbox returned), and WHEP (POST returns an SDP
 * answer and a session Location, DELETE ends it). Any non-empty bearer token
 * is accepted; nothing is forwarded to Ring.
 */

export const MOCK_PLAYGROUND_DEFAULT_PORT = 3271
const MAX_BODY_BYTES = 100_000

export type MockPlaygroundHandler = ((request: Request) => Promise<Response>) & {
  /** WHEP sessions started and not yet deleted. */
  readonly activeSessions: () => readonly string[]
}

const jsonApi = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": CONTENT_TYPES.jsonApi } })

const errorDoc = (status: number, title: string, detail: string): Response =>
  jsonApi({ errors: [{ status: String(status), title, detail }] }, status)

const fixture = (name: PlaygroundFixtureName, status = 200): Response => jsonApi(PLAYGROUND_FIXTURES[name], status)

const singleDevice = (): Response => {
  const list = deviceListDocumentSchema.parse(PLAYGROUND_FIXTURES.devicesNoInclude)
  return jsonApi({ data: list.data[0], meta: list.meta })
}

const DEVICE_RESOURCES: Readonly<Record<string, PlaygroundFixtureName>> = {
  status: "status",
  capabilities: "capabilities",
  configurations: "configurations",
  location: "location",
}

const DEVICE_PATH = /^\/v1\/devices\/([^/]+)(?:\/(status|capabilities|configurations|location))?$/
const HISTORY_PATH = /^\/v1\/history\/devices\/([^/]+)\/events$/
const WHEP_PATH = /^\/v1\/devices\/([^/]+)\/media\/streaming\/whep\/sessions(?:\/([^/]+))?$/

const isBearer = (request: Request): boolean => /^Bearer \S+$/.test(request.headers.get("authorization") ?? "")

const decodeSegment = (segment: string | undefined): string | undefined => {
  try {
    return segment === undefined ? undefined : decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

const notShared = (): Response => errorDoc(404, "Not Found", "Device not shared with this application")

const getRoute = (url: URL, deviceId: string): Response => {
  if (url.pathname === ENDPOINTS.me) return fixture("me")
  if (url.pathname === ENDPOINTS.devices) return fixture(url.searchParams.has("include") ? "devices" : "devicesNoInclude")
  if (url.pathname === ENDPOINTS.subscriptions) return fixture("subscriptions422", 422)
  const history = HISTORY_PATH.exec(url.pathname)
  if (history) return decodeSegment(history[1]) === deviceId ? fixture("history") : notShared()
  const device = DEVICE_PATH.exec(url.pathname)
  if (!device) return errorDoc(404, "Not Found", "No such route on the mock Playground")
  if (decodeSegment(device[1]) !== deviceId) return notShared()
  const resource = device[2] ? DEVICE_RESOURCES[device[2]] : undefined
  return resource ? fixture(resource) : singleDevice()
}

/** A fetch style handler; usable directly as `RingClient`'s `fetch`. */
export const createMockPlaygroundHandler = (
  options: { readonly deviceId?: string } = {}
): MockPlaygroundHandler => {
  const deviceId = options.deviceId ?? PLAYGROUND_DEVICE_ID
  let sessions: ReadonlySet<string> = new Set()

  const whep = async (request: Request, match: RegExpExecArray): Promise<Response> => {
    if (decodeSegment(match[1]) !== deviceId) return notShared()
    if (request.method === "DELETE" && match[2]) {
      const known = sessions.has(match[2])
      sessions = new Set([...sessions].filter((id) => id !== match[2]))
      return known ? new Response(null, { status: 204 }) : errorDoc(404, "Not Found", "Unknown WHEP session")
    }
    if (request.method !== "POST" || match[2]) return errorDoc(405, "Method Not Allowed", "Use POST or DELETE")
    const offer = await request.text()
    if (!offer.startsWith("v=0")) return errorDoc(400, "Bad Request", "Send an SDP offer")
    const sessionId = randomUUID()
    sessions = new Set([...sessions, sessionId])
    return new Response(buildMockSdpAnswer(offer, String(Date.now())), {
      status: 201,
      headers: { "content-type": CONTENT_TYPES.sdp, [HEADERS.location]: `${match[0]}/${sessionId}` },
    })
  }

  const handle = async (request: Request): Promise<Response> => {
    if (!isBearer(request)) return errorDoc(401, "Unauthorized", "Missing bearer token")
    const url = new URL(request.url)
    const whepMatch = WHEP_PATH.exec(url.pathname)
    if (whepMatch) return whep(request, whepMatch)
    if (request.method !== "GET") return errorDoc(405, "Method Not Allowed", "The mock Playground is read only")
    return getRoute(url, deviceId)
  }

  return Object.assign(handle, { activeSessions: () => [...sessions] })
}

const readBody = async (req: IncomingMessage): Promise<string | undefined> => {
  let size = 0
  let chunks: readonly Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body too large")
    chunks = [...chunks, buffer]
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined
}

const toRequest = async (req: IncomingMessage, origin: string): Promise<Request> => {
  const headers = new Headers()
  Object.entries(req.headers).forEach(([name, value]) => {
    if (typeof value === "string") headers.set(name, value)
  })
  const method = req.method ?? "GET"
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req)
  return new Request(new URL(req.url ?? "/", origin), { method, headers, ...(body === undefined ? {} : { body }) })
}

const writeResponse = async (res: ServerResponse, response: Response): Promise<void> => {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(Buffer.from(await response.arrayBuffer()))
}

export interface MockPlaygroundServer {
  readonly url: string
  readonly handler: MockPlaygroundHandler
  close(): Promise<void>
}

/** The origin the server actually bound, so port 0 (an ephemeral port) works. */
const boundOrigin = (server: Server, host: string, requestedPort: number): string => {
  const address = server.address()
  const port = address !== null && typeof address === "object" ? address.port : requestedPort
  return `http://${host}:${port}`
}

/** Starts the mock on 127.0.0.1 (default port 3271; pass port 0 for an ephemeral one). */
export const startMockPlayground = (
  options: { readonly port?: number; readonly host?: string; readonly deviceId?: string } = {}
): Promise<MockPlaygroundServer> => {
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? MOCK_PLAYGROUND_DEFAULT_PORT
  const handler = createMockPlaygroundHandler(options.deviceId ? { deviceId: options.deviceId } : {})
  const server = createServer((req, res) => {
    toRequest(req, boundOrigin(server, host, port))
      .then(handler)
      .then((response) => writeResponse(res, response))
      .catch(() => writeResponse(res, errorDoc(400, "Bad Request", "The mock could not read the request")))
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () =>
      resolve({
        url: boundOrigin(server, host, port),
        handler,
        close: () => new Promise((done) => server.close(() => done())),
      })
    )
  })
}

const cliPortSchema = z.coerce.number().int().min(1).max(65_535).default(MOCK_PLAYGROUND_DEFAULT_PORT)

const runCli = async (): Promise<void> => {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length)
  const port = cliPortSchema.parse(portArg || undefined)
  const mock = await startMockPlayground({ port })
  const print = (line: string): void => void process.stdout.write(`${line}\n`)
  print(`Mock Ring Playground serving captured responses at ${mock.url}`)
  print(`Start the console against it (any non-empty token works; never use a real one here):`)
  print(`  RING_API_BASE=${mock.url} RING_PLAYGROUND_ACCESS_TOKEN=mock-playground pnpm --filter @visitproof/console dev`)
  const stop = (): void => void mock.close().then(() => process.exit(0))
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`Mock Ring Playground failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
