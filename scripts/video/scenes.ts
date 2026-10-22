/**
 * The demo video, scene by scene: what is on screen, for how long, the
 * burned-in caption, and the voiceover line. `buildScenes(mode)` returns the
 * offline or live cut. Offline has no Ring token, so the Ring scene is a
 * short one: the Ring account link page, then Device Check's "Live Mode Is
 * Off" state, captioned as the linking step. The ten seconds it saves go to
 * the scheduler scene. Both cuts run the same length.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { promisify } from "node:util"

import type { Frame, Locator, Page } from "@playwright/test"

import {
  glideClick,
  glideToPoint,
  pause,
  scrollBy,
  scrollToTarget,
  scrollToTop,
  typeSlowly,
} from "./interact"

export type Mode = "live" | "offline"
export type Role = "scheduler" | "compliance" | "family" | "caregiver"
/** Where a scene's app runs: the page, or for the phone scene the iframe inside it. */
export type Surface = Page | Frame

export interface PlayContext {
  readonly mode: Mode
  /** The app itself: the page for desktop scenes, the phone iframe for mobile ones. */
  readonly surface: Surface
  readonly baseUrl: string
  /** Scratch directory for downloads (the PDF pack). */
  readonly workDir: string
  /** Records something worth knowing in manifest.json. */
  note(message: string): void
  /**
   * Ends the scene on a still image for the last `seconds`, cross-faded in
   * by the recorder, instead of the page. `render` runs after the camera
   * stops (so slow work is not filmed) and returns a 1920x1080 PNG, or null
   * to skip the still.
   */
  appendStill(render: () => Promise<string | null>, seconds: number): void
  /**
   * Runs `wait` (typically "until the next page is ready") and drops that
   * stretch from the clip, so a route change never shows the loading
   * skeleton. Call it right after the click that navigates.
   */
  cutWhile(wait: () => Promise<void>): Promise<void>
}

export type CardContent =
  | { readonly layout: "hero"; readonly title: string; readonly tagline: string; readonly pills: readonly string[] }
  | { readonly layout: "statements"; readonly eyebrow: string; readonly lines: readonly string[] }
  | {
      readonly layout: "columns"
      readonly title: string
      readonly columns: readonly { readonly heading: string; readonly items: readonly string[] }[]
    }
  | { readonly layout: "closing"; readonly statement: string; readonly link: string }

interface SceneBase {
  readonly id: string
  readonly duration: number
  /** Lower-third caption, sentence case. Cards carry their own text, so theirs is null. */
  readonly caption: string | null
  readonly voiceover: string
}

export interface CardScene extends SceneBase {
  readonly kind: "card"
  readonly card: CardContent
}

export interface AppScene extends SceneBase {
  readonly kind: "app"
  readonly role: Role
  /** "mobile" runs the app in a phone-sized iframe, shown large on the dark background. */
  readonly device: "desktop" | "mobile"
  /** html zoom for desktop scenes, so the 1920x1080 recording reads like a 1280x720 page (1.5). */
  readonly scale?: number
  readonly path: string
  /** Routes visited in the recording page before `path`, trimmed from the clip, so later client navigations do not show the loading skeleton. */
  readonly prewarm?: readonly string[]
  /** Extra CSS injected for this scene only (layout tweaks for 1080p legibility). */
  readonly css?: string
  /** Resolves once the first screen shows real content (not the loading skeleton). */
  ready(surface: Surface): Promise<void>
  play(page: Page, ctx: PlayContext): Promise<void>
}

export type Scene = CardScene | AppScene

const visible = { state: "visible" } as const

/** A button or link by accessible name (Base UI renders links as role="button"). */
const control = (scope: Surface | Locator, name: string | RegExp): Locator =>
  scope
    .getByRole("button", { name, exact: typeof name === "string" })
    .or(scope.getByRole("link", { name, exact: typeof name === "string" }))
    .first()

const navItem = (page: Page, name: string): Locator => control(page.getByRole("navigation").first(), name)

const heading = (page: Surface, name: string) =>
  page.getByRole("heading", { name, exact: true }).first().waitFor({ ...visible, timeout: 30_000 })

const text = (page: Surface, value: string | RegExp) =>
  page.getByText(value).first().waitFor({ ...visible, timeout: 30_000 })

async function playRingLive(page: Page, ctx: PlayContext): Promise<void> {
  await pause(page, 2200)
  await glideClick(page, page.getByRole("button", { name: "Sync Ring History" }))
  await page
    .getByText(/Ring History Synced|Could Not Sync Ring History/)
    .first()
    .waitFor({ ...visible, timeout: 15_000 })
    .catch(() => ctx.note("Sync Ring History showed no toast within 15 s"))
  await pause(page, 3000)
  await glideClick(page, navItem(page, "Live View"))
  await ctx.cutWhile(() => heading(page, "Live View"))
  const start = page.getByRole("button", { name: "Start Live View" })
  await start.waitFor({ ...visible, timeout: 20_000 })
  await pause(page, 1200)
  await glideClick(page, start)
  const stop = page.getByRole("button", { name: "Stop Live View" })
  await stop.waitFor({ ...visible, timeout: 10_000 })
  await pause(page, 8000)
  await glideClick(page, stop)
  await pause(page, 1200)
}

/**
 * Offline Ring scene: the Ring account page a family lands on from the Ring
 * app, then Device Check, which needs a Ring token and so shows its setup
 * state. The recorder holds the last frame for the rest of the scene.
 */
async function playRingOffline(page: Page, ctx: PlayContext): Promise<void> {
  await pause(page, 3400)
  await glideClick(page, control(page, "Run Device Check"))
  await ctx.cutWhile(() => heading(page, "Device Check"))
  // The button sat where the empty state's title now is; move off it.
  await glideToPoint(page, 1500, 760)
}

async function playScheduler(page: Page, ctx: PlayContext): Promise<void> {
  const long = ctx.mode === "offline"
  await pause(page, long ? 2200 : 1800)
  await scrollToTarget(page, page.getByText("Exception Cards", { exact: true }).first(), 1600)
  await pause(page, long ? 1800 : 1200)
  await scrollBy(page, 420, 2000)
  await pause(page, long ? 1300 : 800)
  if (long) {
    await scrollBy(page, 420, 2000)
    await pause(page, 1300)
  }
  // Prefer a visit the door actually observed, so the Observed tab has entries.
  const observedCard = page.locator('[data-slot="item"]').filter({ hasText: "Early Departure" }).first()
  const hasObserved = (await observedCard.count()) > 0
  if (!hasObserved) ctx.note("no Early Departure card today; opened the first visit instead")
  const target = hasObserved ? observedCard : page.getByText("Exception Cards", { exact: true }).first()
  await scrollToTarget(page, target, 1400, hasObserved ? 220 : 90)
  await pause(page, 400)
  await glideClick(page, control(hasObserved ? observedCard : page, "View Visit"))
  const observed = page.getByRole("tab", { name: /^Observed/ })
  await ctx.cutWhile(() => observed.waitFor({ ...visible, timeout: 30_000 }))
  await pause(page, 1500)
  // Lift the tab strip to about a quarter of the frame so every row under
  // each tab ends above the caption band.
  await scrollToTarget(page, page.getByRole("tablist").first(), 1500, 270)
  await pause(page, long ? 2600 : 2000)
  await glideClick(page, page.getByRole("tab", { name: /^Reported/ }))
  await pause(page, long ? 2800 : 2100)
  await glideClick(page, page.getByRole("tab", { name: /^Resolved/ }))
  await pause(page, long ? 2800 : 2100)
  await glideClick(page, navItem(page, "Today"))
  await ctx.cutWhile(() => text(page, "Exception Cards"))
  await pause(page, 800)
  const backfill = page.getByRole("button", { name: "Backfill Times" }).first()
  await scrollToTarget(page, backfill, 1300, 260)
  await glideClick(page, backfill)
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ ...visible, timeout: 10_000 })
  await pause(page, long ? 3200 : 2800)
  await glideClick(page, dialog.getByRole("button", { name: "Cancel" }))
  await pause(page, 600)
}

const run = promisify(execFile)
const PDF_STILL_SECONDS = 4.5

/**
 * Rasterises page 1 of the evidence pack with macOS Quick Look and shows its
 * top half (title, pack hash, statement, first visit) large enough to read at
 * 1080p, on the app's dark background and above the caption band. Returns
 * null when Quick Look is unavailable.
 */
async function pdfStill(pdfPath: string, workDir: string, page: Page): Promise<string | null> {
  const qlmanage = "/usr/bin/qlmanage"
  if (!existsSync(qlmanage)) return null
  await run(qlmanage, ["-t", "-s", "2600", "-o", workDir, pdfPath], { timeout: 60_000 })
  const raster = `${pdfPath.slice(pdfPath.lastIndexOf("/") + 1)}.png`
  const rasterPath = `${workDir}/${raster}`
  if (!existsSync(rasterPath)) return null
  const still = await page.context().browser()?.newPage({ viewport: { width: 1920, height: 1080 } })
  if (!still) return null
  try {
    const html = `${workDir}/evidence-pack-still.html`
    await writeFile(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><title>Evidence Pack</title></head>` +
        `<body style="margin:0;width:1920px;height:1080px;background:oklch(0.145 0 0);display:flex;justify-content:center;align-items:flex-start">` +
        // The page's top 46 percent, 1500 px wide: body text reads at about 22 px.
        `<div style="width:1500px;height:900px;margin-top:24px;overflow:hidden;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.6);` +
        `-webkit-mask-image:linear-gradient(to bottom,#000 86%,transparent)">` +
        `<img src="${raster}" style="display:block;width:1500px"></div></body></html>`
    )
    await still.goto(`file://${html}`)
    await still.locator("img").evaluate((img) => (img as HTMLImageElement).decode())
    const png = `${workDir}/evidence-pack-still.png`
    await still.screenshot({ path: png })
    return png
  } finally {
    await still.close()
  }
}

async function playCompliance(page: Page, ctx: PlayContext): Promise<void> {
  await pause(page, 2400)
  await scrollToTarget(page, page.getByText("Reconciliation", { exact: true }).first(), 1500)
  await pause(page, 900)
  await glideClick(page, page.getByRole("button", { name: "Two Weeks" }))
  await pause(page, 1300)
  await glideClick(page, page.getByRole("tab", { name: /^Contradicted/ }))
  await pause(page, 5200)
  await scrollToTarget(page, page.getByText("Signed Evidence Records", { exact: true }).first(), 1700)
  await pause(page, 4000)
  await scrollToTop(page, 1400)
  const pdf = control(page, /^PDF For/)
  const [download] = await Promise.all([page.waitForEvent("download"), glideClick(page, pdf)])
  const pdfPath = `${ctx.workDir}/evidence-pack.pdf`
  await download.saveAs(pdfPath)
  await pause(page, 600)
  ctx.appendStill(async () => {
    try {
      const still = await pdfStill(pdfPath, ctx.workDir, page)
      if (!still) ctx.note("PDF still skipped: Quick Look (qlmanage) could not rasterise the evidence pack")
      return still
    } catch (error) {
      ctx.note(`PDF still skipped: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`)
      return null
    }
  }, PDF_STILL_SECONDS)
}

async function playFamily(page: Surface): Promise<void> {
  await pause(page, 2800)
  await scrollToTarget(page, page.getByText(/^Today, /).first(), 1800, 70)
  await pause(page, 3200)
  await scrollBy(page, 260, 1500)
  await pause(page, 1800)
  await scrollToTarget(page, page.getByText("Consent Controls", { exact: true }).first(), 2200, 130)
  await pause(page, 4000)
}

async function playCaregiver(page: Page): Promise<void> {
  await pause(page, 2600)
  const note = page.getByLabel("Add A Note")
  await scrollToTarget(page, note, 1300, 300)
  await glideClick(page, note, 250)
  await typeSlowly(note, "The EVV app would not open at the door, so I could not clock in.", 38)
  await pause(page, 600)
  await glideClick(page, page.getByRole("button", { name: "Submit Note" }))
  await text(page, "Note Added")
  await pause(page, 2200)
}

async function playAsk(page: Page): Promise<void> {
  await pause(page, 1500)
  await glideClick(page, page.getByRole("button", { name: "Did the caregiver come today?" }))
  await text(page, "Visit Status")
  await pause(page, 900)
  // Lift the Device Preview so the whole Echo Show card sits above the caption.
  const preview = page.getByText("Device Preview", { exact: true }).first()
  await scrollToTarget(page, preview, 1300, 70)
  await pause(page, 2600)
  const detail = page.getByRole("tab", { name: "Response Detail" })
  await scrollToTarget(page, detail, 1400, 110)
  await glideClick(page, detail)
  await pause(page, 2600)
  // End on the full answer and Echo Show card, not on the JSON, with the
  // cursor out in the right margin rather than over the answer.
  await glideToPoint(page, 1860, 640)
  await scrollToTarget(page, preview, 1400, 70)
}

const RING_SECONDS = { live: 22, offline: 12 } as const
const SCHEDULER_SECONDS = { live: 30, offline: 40 } as const

export function buildScenes(mode: Mode): readonly Scene[] {
  const live = mode === "live"
  const scenes: readonly Scene[] = [
    {
      id: "intro",
      kind: "card",
      duration: 10,
      caption: null,
      voiceover:
        "This is VisitProof. It proves that a home care visit happened, using the Ring doorbell the family already has at the door.",
      card: {
        layout: "hero",
        title: "VisitProof",
        tagline: "Proof of presence for home care, from the doorbell already at the door.",
        pills: ["Ring Track", "AWS Builder", "Open Source", "Alexa+"],
      },
    },
    {
      id: "problem",
      kind: "card",
      duration: 14,
      caption: null,
      voiceover:
        "In 2026, Medicaid hard edits deny claims without a verified visit. Phone GPS clock-ins drift, get spoofed, and die with the battery. Families cannot tell if anyone came.",
      card: {
        layout: "statements",
        eyebrow: "The Problem",
        lines: [
          "In 2026, Medicaid EVV hard edits deny claims without a verified visit.",
          "Phone GPS clock-ins drift, get spoofed, and die with the battery.",
          "Families cannot tell whether the caregiver came.",
        ],
      },
    },
    live
      ? {
          id: "ring-live",
          kind: "app",
          role: "family",
          device: "desktop",
          scale: 1.5,
          path: "/family/devices",
          prewarm: ["/family/live"],
          duration: RING_SECONDS.live,
          caption: "Device check, history sync, and live view over WHEP, all from Ring.",
          voiceover:
            "The family links Ring once. Device Check reads the doorbell settings from the Ring Partner API, and Sync Ring History pulls past door events. Live View streams the doorbell over WHEP, with a time cap.",
          ready: (page) => heading(page, "Device Check"),
          play: playRingLive,
        }
      : {
          id: "ring-live",
          kind: "app",
          role: "family",
          device: "desktop",
          scale: 1.5,
          path: "/ring",
          prewarm: ["/family/devices"],
          duration: RING_SECONDS.offline,
          caption: "Families link Ring once, from the Ring app, to turn on Device Check.",
          voiceover:
            "The family links Ring once, from the Ring Appstore. With a live token, Device Check reads the doorbell settings, and Live View streams the door over WHEP.",
          ready: (page) =>
            page
              .getByRole("heading", { name: /^(Account Linked Successfully|Link Your Ring)$/ })
              .first()
              .waitFor({ ...visible, timeout: 30_000 }),
          play: playRingOffline,
        },
    {
      id: "scheduler",
      kind: "app",
      role: "scheduler",
      device: "desktop",
      scale: 1.5,
      path: "/agency/today",
      duration: SCHEDULER_SECONDS[mode],
      caption: "Exceptions from the doorbell, and three columns that never merge.",
      voiceover:
        live
          ? "The scheduler starts on Agency Today. Signed Ring events are matched to the schedule, and anything off becomes an exception card. A visit record keeps three columns that never merge: Observed, Reported, and Resolved. Fixes go through Backfill Times, which signs a new record."
          : "The scheduler starts on Agency Today. Signed Ring events are matched to the schedule, and anything off becomes an exception card: a no show, a late arrival, an early departure, or a doorbell that went offline. A visit record keeps three columns that never merge. Observed is what the door saw. Reported is the clock-in and notes. Resolved is what the agency decided. Fixes go through Backfill Times, which signs a new record instead of rewriting the door.",
      ready: (page) => heading(page, "Agency Today"),
      play: playScheduler,
    },
    {
      id: "compliance",
      kind: "app",
      role: "compliance",
      device: "desktop",
      scale: 1.25,
      path: "/agency/compliance",
      // The page caps at max-w-6xl, which clips the Outcome column at 1080p;
      // a wider cap lets the whole reconciliation table fit.
      css: ".max-w-6xl{max-width:80rem!important}",
      duration: 28,
      caption: "Door presence checked against EVV clock-ins, then a signed PDF pack.",
      voiceover:
        "Compliance reconciles door presence with EVV clock-ins. Over two weeks, the Contradicted filter shows clock-ins that started long before anyone reached the door. Every record sits in a signed, hash chained ledger, and one click exports a PDF evidence pack an auditor can check.",
      ready: (page) => heading(page, "Compliance"),
      play: playCompliance,
    },
    {
      id: "family",
      kind: "app",
      role: "family",
      device: "mobile",
      path: "/family",
      duration: 18,
      caption: "On a phone: one calm summary a day, and full control over sharing.",
      voiceover:
        "On a phone, the family gets one calm message a day, and an alert only when something needs attention. They decide what is shared, whether snapshots are kept, and which alerts arrive.",
      ready: (page) => text(page, /^Today, /),
      play: (_page, ctx) => playFamily(ctx.surface),
    },
    {
      id: "caregiver",
      kind: "app",
      role: "caregiver",
      device: "desktop",
      scale: 1.5,
      path: "/me",
      duration: 12,
      caption: "A caregiver explains a missing clock-in, and the note is signed.",
      voiceover:
        "Caregivers see their own record. When the door saw them but the clock-in is missing, they add a note, and it is signed into the evidence record.",
      ready: (page) => text(page, "Missing Clock-In With Door Presence"),
      play: (page) => playCaregiver(page),
    },
    {
      id: "ask",
      kind: "app",
      role: "family",
      device: "desktop",
      scale: 1.5,
      path: "/ask",
      // Wrap the Response Detail JSON so no answer line runs off the frame.
      css: "pre{white-space:pre-wrap!important;word-break:break-word!important}",
      duration: 18,
      caption: "Ask VisitProof: a real MCP tool call, shown as an Echo Show card.",
      voiceover:
        "Ask VisitProof brings these answers to Alexa+. Each question is a real MCP tool call, rendered as an Echo Show card. Here, a fixture brain stands in for Bedrock Nova to choose the tool. Response Detail shows the raw call.",
      ready: (page) => heading(page, "Ask VisitProof"),
      play: (page) => playAsk(page),
    },
    {
      id: "architecture",
      kind: "card",
      duration: 10,
      caption: null,
      voiceover:
        "Under the hood: verified Ring webhooks, a serverless AWS pipeline built with CDK, Bedrock Nova for narratives, and an MCP server for Alexa+.",
      card: {
        layout: "columns",
        title: "How It Is Built",
        columns: [
          {
            heading: "Ring Partner API",
            items: ["HMAC-verified webhooks", "Devices and history", "WHEP live view", "Account linking"],
          },
          {
            heading: "AWS",
            items: ["Lambda and API Gateway", "DynamoDB Streams", "EventBridge, S3, KMS, SES", "Bedrock Nova 2 Lite", "CDK"],
          },
          {
            heading: "Quality",
            items: ["Alexa+ MCP server", "MCP spec 2025-11-25", "576 tests", "Apache-2.0"],
          },
        ],
      },
    },
    {
      id: "outro",
      kind: "card",
      duration: 6,
      caption: null,
      voiceover: "VisitProof shows that a person arrived at the door. It never identifies who.",
      card: {
        layout: "closing",
        statement: "VisitProof shows that a person arrived at the door. It never identifies who.",
        link: "github.com/CodeWithEugene/Amazon-Developer-Hackathon",
      },
    },
  ]
  return scenes
}

/** Words per second the voiceover is sized for. */
export const WORDS_PER_SECOND = 2.3

export const wordCount = (value: string): number =>
  value.split(/\s+/).filter((word) => word.length > 0).length
