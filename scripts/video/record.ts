/**
 * Records the VisitProof demo video end to end:
 *
 *   pnpm exec tsx scripts/video/record.ts
 *
 * 1. starts `pnpm demo` on ports 3240, 3241 and 3242 with its own store;
 * 2. warms every route so no scene shows the dev compiler's loading state;
 * 3. renders the title cards and records each app scene at 1920x1080;
 * 4. trims, concatenates, and burns the captions with ffmpeg;
 * 5. writes out/manifest.json, voiceover.md, and one frame per scene in
 *    tmp/frames/, then stops every process it started.
 *
 * Live mode: export RING_PLAYGROUND_ACCESS_TOKEN in the shell for the run.
 * Development flags: --reuse-server uses a demo already listening on 3240
 * (and leaves it running); --only=a,b re-records just those app scenes and
 * reuses the other clips from the previous run.
 */
import { existsSync } from "node:fs"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "@playwright/test"

import { FORBIDDEN_DASHES, captionHtml, cardHtml } from "./cards"
import {
  BASE_URL,
  PORTS,
  eveningClockOffset,
  isListening,
  portsStillBusy,
  startDemo,
  type DemoServer,
} from "./demo-server"
import {
  burnCaptions,
  clipFromRecording,
  clipFromStill,
  clipFromStillSequence,
  clipWithStillTail,
  CROSSFADE,
  type Span,
  concatClips,
  extractFrame,
  hasDrawtext,
  overlayCaptions,
  probe,
  type CaptionSpan,
} from "./ffmpeg"
import { pageInitScript, parkCursor } from "./interact"
import {
  WORDS_PER_SECOND,
  buildScenes,
  wordCount,
  type AppScene,
  type CardScene,
  type Mode,
  type Role,
  type Scene,
} from "./scenes"
import { voiceoverMarkdown } from "./voiceover"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const DIRS = {
  out: join(HERE, "out"),
  cards: join(HERE, "cards"),
  tmp: join(HERE, "tmp"),
  raw: join(HERE, "tmp", "raw"),
  clips: join(HERE, "tmp", "clips"),
  stills: join(HERE, "tmp", "stills"),
  captions: join(HERE, "tmp", "captions"),
  frames: join(HERE, "tmp", "frames"),
  work: join(HERE, "tmp", "work"),
}
const MAX_SECONDS = 175
/** The phone viewport: a phone's width, cropped short so it can be shown large. */
const PHONE = { width: 430, height: 620 } as const
/** How tall the phone appears in the 1080p frame, ending above the caption band. */
const PHONE_SHOWN_HEIGHT = 900
/** A same-origin address the recorder answers itself with the phone host page. */
const PHONE_HOST_PATH = "/__visitproof-video-phone"
/** How the architecture card splits its time: one share per column, then all columns. */
const COLUMN_SHARES = [0.28, 0.3, 0.2, 0.22] as const

/**
 * Offset from the wall clock to the demo's simulated "now", shared by the
 * Node processes (clock-shift.cjs) and every recording page. Set once the
 * demo has started.
 */
let clockOffsetMs = 0
/**
 * Where a cut starts relative to the navigating click returning. Slightly
 * negative: the video's clock trails Date.now() by a frame or two, and a
 * single skeleton frame otherwise slips through.
 */
const CUT_AFTER_CLICK = -0.1
/** Settle time after the next page is ready, also cut, so it appears fully painted. */
const CUT_SETTLE_MS = 150
/** Longest caption that still fits on one line of the lower third. */
const CAPTION_WRAP = 72

interface SceneResult {
  readonly scene: Scene
  readonly clip: string
  readonly captured: boolean
  readonly notes: readonly string[]
}

const say = (message: string) => process.stdout.write(`[video] ${message}\n`)

const simulatedNow = (): string =>
  new Date(Date.now() + clockOffsetMs).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " ET"

function parseArgs(argv: readonly string[]) {
  const only = argv.find((arg) => arg.startsWith("--only="))
  return {
    reuseServer: argv.includes("--reuse-server"),
    only: only ? new Set(only.slice("--only=".length).split(",").filter(Boolean)) : null,
  }
}

function validateCopy(scenes: readonly Scene[]): string[] {
  const problems: string[] = []
  for (const scene of scenes) {
    const onScreen = [scene.caption ?? "", scene.kind === "card" ? JSON.stringify(scene.card) : ""]
    if (onScreen.some((value) => FORBIDDEN_DASHES.test(value))) problems.push(`${scene.id}: on-screen text has an em or en dash`)
    if (FORBIDDEN_DASHES.test(scene.voiceover)) problems.push(`${scene.id}: voiceover has an em or en dash`)
    if (scene.caption && scene.caption.length > CAPTION_WRAP) problems.push(`${scene.id}: caption is over ${CAPTION_WRAP} characters, so it would wrap`)
    const budget = Math.floor(scene.duration * WORDS_PER_SECOND)
    const words = wordCount(scene.voiceover)
    if (words > budget) problems.push(`${scene.id}: voiceover has ${words} words, budget ${budget}`)
  }
  return problems
}

function wrap(text: string, width: number): string {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join("\n")
}

async function signedInContext(
  browser: Browser,
  role: Role,
  options: Parameters<Browser["newContext"]>[0],
  zoom = 1,
  extraCss = ""
): Promise<BrowserContext> {
  const context = await browser.newContext({ colorScheme: "dark", ...options })
  await context.addInitScript({ content: pageInitScript(zoom, clockOffsetMs, extraCss) })
  const response = await context.request.post(`${BASE_URL}/api/session`, {
    data: { role },
    headers: { origin: BASE_URL },
  })
  if (!response.ok()) throw new Error(`demo sign-in as ${role} failed with HTTP ${response.status()}`)
  return context
}

/** Visits every route once so next dev compiles it before the camera rolls. Returns the effective mode. */
async function warmRoutes(browser: Browser, requested: Mode): Promise<Mode> {
  const routes: Record<Role, readonly string[]> = {
    scheduler: ["/agency/today"],
    compliance: ["/agency/compliance"],
    family: ["/family", "/family/devices", "/family/live", "/ask"],
    caregiver: ["/me"],
  }
  let mode = requested
  for (const [role, paths] of Object.entries(routes) as [Role, readonly string[]][]) {
    const context = await signedInContext(browser, role, { viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    for (const path of paths) {
      say(`warming ${path} as ${role}`)
      await page.goto(`${BASE_URL}${path}`, { timeout: 180_000 })
      await page.waitForLoadState("networkidle", { timeout: 180_000 })
      if (path === "/family/devices" && (await page.getByText("Live Mode Is Off").count()) > 0) mode = "offline"
    }
    if (role === "scheduler") {
      const href = await page.getByText("View Visit").first().evaluate((el) => el.closest("a")?.getAttribute("href"))
      if (href) await page.goto(`${BASE_URL}${href}`, { timeout: 180_000 })
      await page.getByRole("tab", { name: /^Observed/ }).waitFor({ timeout: 180_000 })
    }
    if (role === "compliance") {
      const href = await page.getByText(/^PDF For/).first().evaluate((el) => el.closest("a")?.getAttribute("href"))
      if (href) await context.request.get(`${BASE_URL}${href}`, { timeout: 180_000 })
    }
    if (role === "family") {
      await page.getByRole("button", { name: "Did the caregiver come today?" }).click()
      await page.getByText("Visit Status").first().waitFor({ timeout: 180_000 })
    }
    if (role === "caregiver") {
      // Compiles the notes route without saving anything (an empty body is rejected).
      await context.request.post(`${BASE_URL}/api/notes`, { data: {}, headers: { origin: BASE_URL }, timeout: 180_000 })
    }
    await context.close()
  }
  return mode
}

async function renderCard(browser: Browser, scene: CardScene): Promise<string> {
  const html = join(DIRS.cards, `${scene.id}.html`)
  const title = `VisitProof ${scene.id.charAt(0).toUpperCase()}${scene.id.slice(1)} Card`
  await writeFile(html, cardHtml(title, scene.card))
  // The columns card walks through its columns one at a time, then shows all.
  const focuses: readonly (number | undefined)[] =
    scene.card.layout === "columns" ? [...scene.card.columns.keys(), undefined] : [undefined]
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" })
  const pngs: string[] = []
  try {
    for (const [index, focus] of focuses.entries()) {
      const stepHtml = focus === undefined ? html : join(DIRS.stills, `${scene.id}-${index}.html`)
      if (focus !== undefined) await writeFile(stepHtml, cardHtml(title, scene.card, focus))
      await page.goto(`file://${stepHtml}`)
      await page.evaluate(() => document.fonts.ready.then(() => true))
      const png = join(DIRS.stills, focuses.length > 1 ? `${scene.id}-${index}.png` : `${scene.id}.png`)
      await page.screenshot({ path: png })
      pngs.push(png)
    }
  } finally {
    await page.close()
  }
  const clip = join(DIRS.clips, `${scene.id}.mp4`)
  if (pngs.length === 1) await clipFromStill(pngs[0]!, scene.duration, clip)
  else {
    const shares = pngs.length === COLUMN_SHARES.length ? COLUMN_SHARES : pngs.map(() => 1 / pngs.length)
    await clipFromStillSequence(pngs, shares, scene.duration, clip)
  }
  return clip
}

/**
 * The phone scene's host page: the app's near-black background (the cards'
 * --background) with the app in a phone-sized iframe, framed by the app's
 * border token and scaled to PHONE_SHOWN_HEIGHT. Served from the console's
 * own origin, so the iframe is same-origin and the session cookie applies.
 */
function phoneHostHtml(path: string): string {
  const zoom = PHONE_SHOWN_HEIGHT / PHONE.height
  const bezel = 6
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VisitProof On A Phone</title>
<style>
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: oklch(0.145 0 0); }
.phone {
  position: absolute; top: 20px; left: ${Math.round((1920 - PHONE.width * zoom) / 2) - bezel}px;
  width: ${Math.round(PHONE.width * zoom)}px; height: ${PHONE_SHOWN_HEIGHT}px;
  border: ${bezel}px solid oklch(1 0 0 / 10%); border-radius: 18px; overflow: hidden; background: oklch(0.145 0 0);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
iframe { border: 0; width: ${PHONE.width}px; height: ${PHONE.height}px; transform: scale(${zoom.toFixed(5)}); transform-origin: 0 0; }
</style></head>
<body><div class="phone"><iframe src="${path}" title="VisitProof"></iframe></div></body></html>
`
}

async function recordOnce(browser: Browser, scene: AppScene, mode: Mode, notes: string[]): Promise<string> {
  const rawDir = join(DIRS.raw, scene.id)
  await rm(rawDir, { recursive: true, force: true })
  const mobile = scene.device === "mobile"
  const scale = scene.scale ?? 1
  // The phone scene is a 1920x1080 page holding the app in a 430 px wide
  // iframe scaled up with a CSS transform. Chromium rasterises the iframe at
  // the scaled size, so the phone is sharp (Playwright records the CSS
  // viewport, so a phone-sized context with a device scale factor is not).
  const context = await signedInContext(
    browser,
    scene.role,
    { viewport: { width: 1920, height: 1080 }, recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } } },
    mobile ? 1 : scale,
    scene.css ?? ""
  )
  try {
    const page = await context.newPage()
    // The recording starts with the page, so everything before the scene's
    // first ready frame (including prewarmed routes) is trimmed off.
    const t0 = Date.now()
    for (const path of scene.prewarm ?? []) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 60_000 })
    }
    let surface: Page | Frame = page
    if (mobile) {
      await page.route(`${BASE_URL}${PHONE_HOST_PATH}`, (route) =>
        route.fulfill({ contentType: "text/html", body: phoneHostHtml(scene.path) })
      )
      await page.goto(`${BASE_URL}${PHONE_HOST_PATH}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
      const frame = await (await page.locator("iframe").elementHandle({ timeout: 30_000 }))?.contentFrame()
      if (!frame) throw new Error("the phone iframe has no frame")
      surface = frame
    } else {
      await page.goto(`${BASE_URL}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    }
    await scene.ready(surface)
    if (!mobile) await parkCursor(page, 1190, 600)
    await page.waitForTimeout(500)
    const start = (Date.now() - t0) / 1000
    const playStart = Date.now()
    let tail: { render: () => Promise<string | null>; seconds: number } | null = null
    const cuts: Span[] = []
    const sinceStart = () => (Date.now() - t0) / 1000
    await scene.play(page, {
      mode,
      surface,
      baseUrl: BASE_URL,
      workDir: DIRS.work,
      note: (message) => notes.push(message),
      appendStill: (render, seconds) => {
        tail = { render, seconds }
      },
      cutWhile: async (wait) => {
        const from = sinceStart() + CUT_AFTER_CLICK
        await wait()
        await page.waitForTimeout(CUT_SETTLE_MS)
        cuts.push({ from, to: sinceStart() })
      },
    })
    const cutSeconds = cuts.reduce((sum, span) => sum + (span.to - span.from), 0)
    if (cuts.length > 0 && tail) notes.push("cuts are only applied to plain desktop clips; ignored here")
    const played = (Date.now() - playStart) / 1000 - cutSeconds
    const pending = tail as { render: () => Promise<string | null>; seconds: number } | null
    const recorded = pending ? scene.duration - pending.seconds + CROSSFADE : scene.duration
    if (played > recorded) notes.push(`play ran ${played.toFixed(1)} s, so the last ${(played - recorded).toFixed(1)} s were cut`)
    else await page.waitForTimeout((recorded - played) * 1000 + 300)
    // A still that fails to render leaves the page on screen for the full scene.
    const stillPng = pending ? await pending.render() : null
    const closing = pending && stillPng ? { png: stillPng, seconds: pending.seconds } : null
    if (pending && !stillPng) await page.waitForTimeout(pending.seconds * 1000)
    const video = page.video()
    await context.close()
    if (!video) throw new Error("no video was recorded")
    const webm = await video.path()
    const clip = join(DIRS.clips, `${scene.id}.mp4`)
    if (closing) await clipWithStillTail(webm, start, scene.duration, closing.png, closing.seconds, clip)
    else await clipFromRecording(webm, start, scene.duration, clip, cuts)
    if (cuts.length > 0) notes.push(`cut ${cuts.length} route change${cuts.length > 1 ? "s" : ""} (${cutSeconds.toFixed(2)} s of loading) from the clip`)
    say(`${scene.id}: start offset ${start.toFixed(2)} s, play ${played.toFixed(1)} of ${scene.duration} s`)
    return clip
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function recordApp(browser: Browser, scene: AppScene, mode: Mode): Promise<SceneResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const notes: string[] = []
    try {
      const clip = await recordOnce(browser, scene, mode, notes)
      return { scene, clip, captured: true, notes: attempt > 1 ? [`succeeded on attempt ${attempt}`, ...notes] : notes }
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error)
      say(`${scene.id}: attempt ${attempt} failed: ${message}`)
      if (attempt === 2) throw new Error(`${scene.id} could not be recorded: ${message}`)
    }
  }
  throw new Error("unreachable")
}

interface TimelineItem {
  readonly start: number
  readonly end: number
  readonly result: SceneResult
}

const toTimeline = (results: readonly SceneResult[]): TimelineItem[] =>
  results.reduce<TimelineItem[]>((acc, result) => {
    const start = acc.at(-1)?.end ?? 0
    return [...acc, { start, end: start + result.scene.duration, result }]
  }, [])

/** Writes each caption as a wrapped text file (for drawtext) and a transparent PNG (for the overlay fallback). */
async function prepareCaptions(browser: Browser, timeline: readonly TimelineItem[]): Promise<CaptionSpan[]> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const spans: CaptionSpan[] = []
  try {
    for (const { start, end, result } of timeline) {
      const caption = result.scene.caption
      if (!caption) continue
      const textFile = join(DIRS.captions, `${result.scene.id}.txt`)
      await writeFile(textFile, wrap(caption, CAPTION_WRAP))
      await page.setContent(captionHtml(caption))
      const png = join(DIRS.captions, `${result.scene.id}.png`)
      await page.screenshot({ path: png, omitBackground: true })
      spans.push({ textFile, png, start, end })
    }
  } finally {
    await page.close()
  }
  return spans
}

async function writeOutputs(
  timeline: readonly TimelineItem[],
  spans: readonly CaptionSpan[],
  mode: Mode
): Promise<{ duration: number; problems: string[] }> {
  const results = timeline.map((item) => item.result)
  const plain = join(DIRS.out, "visitproof-demo-nocaptions.mp4")
  const captioned = join(DIRS.out, "visitproof-demo.mp4")
  say("concatenating clips")
  await concatClips(results.map((result) => result.clip), join(DIRS.work, "concat.txt"), plain)
  const drawtext = await hasDrawtext()
  say(drawtext ? "burning captions with drawtext" : "this ffmpeg has no drawtext; overlaying the caption PNGs instead")
  if (drawtext) await burnCaptions(plain, spans, captioned)
  else await overlayCaptions(plain, spans, captioned)
  const [info, plainInfo] = await Promise.all([probe(captioned), probe(plain)])
  const problems: string[] = []
  for (const [name, file] of [["visitproof-demo.mp4", info], ["visitproof-demo-nocaptions.mp4", plainInfo]] as const) {
    if (file.codec !== "h264" || file.pixFmt !== "yuv420p") problems.push(`${name} is ${file.codec}/${file.pixFmt}`)
    if (file.width !== 1920 || file.height !== 1080) problems.push(`${name} is ${file.width}x${file.height}`)
    if (file.frameRate !== "30/1") problems.push(`${name} frame rate is ${file.frameRate}`)
    if (file.audioStreams > 0) problems.push(`${name} has an audio stream`)
    if (file.duration > MAX_SECONDS) problems.push(`${name} runs ${file.duration.toFixed(2)} s, over the ${MAX_SECONDS} s cap`)
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    mode,
    durationSeconds: Number(info.duration.toFixed(3)),
    captionMethod: drawtext ? "drawtext" : "png-overlay (this ffmpeg build has no drawtext)",
    clock: clockOffsetMs === 0 ? "wall clock" : `simulated, about ${simulatedNow()} at render time`,
    outputs: { captioned: "out/visitproof-demo.mp4", plain: "out/visitproof-demo-nocaptions.mp4" },
    scenes: timeline.map(({ start, end, result }) => ({
      id: result.scene.id,
      kind: result.scene.kind,
      start,
      end,
      mode,
      captured: result.captured,
      caption: result.scene.caption,
      notes: result.notes,
    })),
  }
  await writeFile(join(DIRS.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(HERE, "voiceover.md"), voiceoverMarkdown(timeline.map(({ start, end, result }) => ({ scene: result.scene, start, end })), mode))
  say("extracting one frame per scene")
  await rm(DIRS.frames, { recursive: true, force: true })
  await mkdir(DIRS.frames, { recursive: true })
  for (const { start, end, result } of timeline) {
    await extractFrame(captioned, (start + end) / 2, join(DIRS.frames, `${result.scene.id}.png`))
  }
  return { duration: info.duration, problems }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  for (const dir of Object.values(DIRS)) await mkdir(dir, { recursive: true })
  const token = process.env.RING_PLAYGROUND_ACCESS_TOKEN?.trim() || undefined
  const requested: Mode = token ? "live" : "offline"
  let server: DemoServer | null = null
  let browser: Browser | null = null
  const stopAll = async () => {
    await browser?.close().catch(() => undefined)
    browser = null
    if (server) {
      say(`stopping pnpm demo (process group ${server.pid})`)
      await server.stop()
      server = null
      const busy = await portsStillBusy()
      if (busy.length > 0) say(`warning: ports ${busy.join(", ")} still answer after stopping the demo`)
    }
  }
  process.once("SIGINT", () => void stopAll().then(() => process.exit(130)))
  try {
    if (args.reuseServer) {
      if (!(await isListening(PORTS.console))) throw new Error("--reuse-server: nothing is listening on 3240")
      say("reusing the demo already running on 3240")
    } else {
      // Offline, the demo runs on a simulated evening clock so every "now"
      // (note stamps, the PDF's generated time) falls after today's seeded
      // visits. Live mode keeps the wall clock, which Ring's API relies on.
      clockOffsetMs = requested === "offline" ? eveningClockOffset() : 0
      say(`starting pnpm demo in ${requested} mode on ${PORTS.console}, ${PORTS.webhook}, ${PORTS.mcp}`)
      if (clockOffsetMs !== 0) say(`simulated clock: ${simulatedNow()}`)
      server = await startDemo(join(DIRS.tmp, "demo.log"), token, clockOffsetMs)
      say(`demo ready (process group ${server.pid})`)
    }
    browser = await chromium.launch({ channel: "chromium" })
    const mode = await warmRoutes(browser, requested)
    if (mode !== requested) say(`requested ${requested} mode, but the console reports Live Mode Is Off; recording offline`)
    const scenes = buildScenes(mode)
    const copyProblems = validateCopy(scenes)
    if (copyProblems.length > 0) throw new Error(`copy check failed:\n  ${copyProblems.join("\n  ")}`)
    const results: SceneResult[] = []
    for (const scene of scenes) {
      if (scene.kind === "card") {
        say(`rendering card ${scene.id}`)
        results.push({ scene, clip: await renderCard(browser, scene), captured: true, notes: [] })
        continue
      }
      const existing = join(DIRS.clips, `${scene.id}.mp4`)
      if (args.only && !args.only.has(scene.id) && existsSync(existing)) {
        results.push({ scene, clip: existing, captured: true, notes: ["clip reused from the previous run"] })
        continue
      }
      say(`recording ${scene.id} (${scene.duration} s)`)
      results.push(await recordApp(browser, scene, mode))
    }
    const timeline = toTimeline(results)
    const spans = await prepareCaptions(browser, timeline)
    await browser.close()
    browser = null
    const { duration, problems } = await writeOutputs(timeline, spans, mode)
    say(`final duration ${duration.toFixed(2)} s (${mode} mode)`)
    say(`wrote ${join(DIRS.out, "visitproof-demo.mp4")}`)
    for (const problem of problems) say(`problem: ${problem}`)
    return problems.length > 0 ? 1 : 0
  } finally {
    await stopAll()
    await rm(DIRS.raw, { recursive: true, force: true })
    const leftovers = existsSync(DIRS.work) ? await readdir(DIRS.work) : []
    if (leftovers.length > 0) say(`scratch kept in ${DIRS.work}`)
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[video] failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
)
