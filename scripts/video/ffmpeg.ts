/**
 * ffmpeg and ffprobe steps for the recorder: per-scene clips, the caption
 * pass, concatenation, probing, and frame extraction. Every intermediate is
 * H.264 yuv420p at 1920x1080 and 30 fps so the concat demuxer can copy.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { promisify } from "node:util"

const run = promisify(execFile)

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg"
const FFPROBE = existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe"

export const CAPTION_FONT = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
].find((path) => existsSync(path))

const ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"]

async function ffmpeg(args: readonly string[]): Promise<void> {
  try {
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ""
    throw new Error(`ffmpeg failed: ${stderr.trim() || String(error)}\nargs: ${args.join(" ")}`)
  }
}

/**
 * Escapes a value for a filter option inside a -vf filtergraph, in the two
 * rounds ffmpeg-filters(1) "Notes on filtergraph escaping" describes: first
 * the option level (backslash, quote, colon), then the graph level
 * (backslash, quote, brackets, comma, semicolon).
 */
export function escapeFilterValue(value: string): string {
  const option = value.replace(/[\\':]/g, "\\$&")
  return option.replace(/[\\'[\],;]/g, "\\$&")
}

const fades = (duration: number, seconds: number) =>
  `fade=t=in:st=0:d=${seconds},fade=t=out:st=${(duration - seconds).toFixed(3)}:d=${seconds}`

/** A still PNG held for `duration` seconds, with short fades. */
export async function clipFromStill(png: string, duration: number, out: string): Promise<void> {
  await ffmpeg([
    "-loop", "1", "-framerate", String(FPS), "-i", png,
    "-t", String(duration),
    "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p,${fades(duration, 0.4)}`,
    ...ENCODE, out,
  ])
}

/** A stretch of a recording, in seconds since it began. */
export interface Span {
  readonly from: number
  readonly to: number
}

/** Seconds two stills (or a recording and its closing still) cross-fade over. */
export const CROSSFADE = 0.5

/**
 * Several stills shown in turn, cross-faded, for `duration` seconds in all.
 * `shares` gives each still's fraction of the time (they should sum to 1).
 */
export async function clipFromStillSequence(
  pngs: readonly string[],
  shares: readonly number[],
  duration: number,
  out: string
): Promise<void> {
  if (pngs.length === 1) return clipFromStill(pngs[0]!, duration, out)
  const inputs = pngs.flatMap((png) => ["-loop", "1", "-framerate", String(FPS), "-t", String(duration), "-i", png])
  const prepared = pngs.map((_, index) => `[${index}:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p,setsar=1,fps=${FPS},settb=AVTB[s${index}]`)
  let elapsed = 0
  const chain = pngs.slice(1).map((_, index) => {
    elapsed += duration * (shares[index] ?? 0)
    const from = index === 0 ? "[s0]" : `[x${index}]`
    return `${from}[s${index + 1}]xfade=transition=fade:duration=${CROSSFADE}:offset=${(elapsed - CROSSFADE / 2).toFixed(3)}[x${index + 1}]`
  })
  const graph = [
    ...prepared,
    ...chain,
    `[x${pngs.length - 1}]trim=duration=${duration},setpts=PTS-STARTPTS,${fades(duration, 0.4)}[v]`,
  ].join(";")
  await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[v]", "-t", String(duration), ...ENCODE, out])
}

/**
 * A Playwright recording that ends on a still: `recordSeconds` of the
 * recording from `start`, then the PNG cross-fades in and holds, for
 * `duration` seconds in all.
 */
export async function clipWithStillTail(
  webm: string,
  start: number,
  duration: number,
  png: string,
  stillSeconds: number,
  out: string
): Promise<void> {
  const recordSeconds = duration - stillSeconds + CROSSFADE
  const graph = [
    `[0:v]fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${recordSeconds},` +
      `trim=duration=${recordSeconds},setpts=PTS-STARTPTS,format=yuv420p,setsar=1,fps=${FPS},settb=AVTB[rec]`,
    `[1:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p,setsar=1,fps=${FPS},settb=AVTB[still]`,
    `[rec][still]xfade=transition=fade:duration=${CROSSFADE}:offset=${(recordSeconds - CROSSFADE).toFixed(3)},` +
      `trim=duration=${duration},setpts=PTS-STARTPTS,${fades(duration, 0.25)}[v]`,
  ].join(";")
  await ffmpeg([
    "-ss", start.toFixed(3), "-i", webm,
    "-loop", "1", "-framerate", String(FPS), "-t", String(stillSeconds + 1), "-i", png,
    "-filter_complex", graph, "-map", "[v]", "-t", String(duration),
    ...ENCODE, out,
  ])
}

/**
 * Cuts `duration` seconds from a Playwright recording starting at `start`
 * (skipping the blank frames before the first page painted). If the
 * recording is short, the last frame is held.
 */
export async function clipFromRecording(
  webm: string,
  start: number,
  duration: number,
  out: string,
  cuts: readonly Span[] = []
): Promise<void> {
  // Cut spans are seconds since the recording began; after the -ss seek the
  // filter's t counts from `start`, so they shift by it.
  const dropped = cuts
    .map((span) => `between(t,${(span.from - start).toFixed(3)},${(span.to - start).toFixed(3)})`)
    .join("+")
  const select = dropped ? `select='not(${dropped})',setpts=N/${FPS}/TB,` : ""
  await ffmpeg([
    "-ss", start.toFixed(3), "-i", webm,
    "-vf",
    `fps=${FPS},${select}scale=${WIDTH}:${HEIGHT}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${duration},` +
      `trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p,${fades(duration, 0.25)}`,
    "-t", String(duration),
    ...ENCODE, out,
  ])
}

/** Joins same-format clips without re-encoding. */
export async function concatClips(clips: readonly string[], listPath: string, out: string): Promise<void> {
  const list = clips.map((clip) => `file ${escapeConcatPath(clip)}`).join("\n")
  await writeFile(listPath, `${list}\n`)
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", out])
}

const escapeConcatPath = (path: string): string => `'${path.replace(/'/g, "'\\''")}'`

export interface CaptionSpan {
  readonly textFile: string
  /** The same caption pre-rendered as a transparent 1920x1080 PNG. */
  readonly png: string
  readonly start: number
  readonly end: number
}

/** Whether this ffmpeg build has drawtext (it needs libfreetype). */
export async function hasDrawtext(): Promise<boolean> {
  const { stdout } = await run(FFMPEG, ["-hide_banner", "-filters"], { maxBuffer: 8 * 1024 * 1024 })
  return /\sdrawtext\s/.test(stdout)
}

const window_ = (span: CaptionSpan) =>
  `between(t,${(span.start + 0.3).toFixed(2)},${(span.end - 0.3).toFixed(2)})`

/**
 * Fallback when drawtext is missing: overlays each caption PNG, enabled
 * only inside its scene, in one encode.
 */
export async function overlayCaptions(input: string, spans: readonly CaptionSpan[], out: string): Promise<void> {
  if (spans.length === 0) {
    await ffmpeg(["-i", input, ...ENCODE, "-movflags", "+faststart", out])
    return
  }
  // Each still loops at the output rate until its scene ends; a single
  // unlooped frame would not reappear for a window late in the video.
  const inputs = spans.flatMap((span) => [
    "-loop", "1", "-framerate", String(FPS), "-t", span.end.toFixed(3), "-i", span.png,
  ])
  const chain = spans.map((span, index) => {
    const from = index === 0 ? "[0:v]" : `[v${index}]`
    const to = index === spans.length - 1 ? "[vout]" : `[v${index + 1}]`
    return `${from}[${index + 1}:v]overlay=x=0:y=0:eof_action=pass:enable='${window_(span)}'${to}`
  })
  await ffmpeg([
    "-i", input, ...inputs,
    "-filter_complex", `${chain.join(";")}`,
    "-map", "[vout]", ...ENCODE, "-movflags", "+faststart", out,
  ])
}

/**
 * Burns each caption as a lower third, enabled only inside its scene. The
 * text comes from a file with expansion off, so no character in a caption
 * (colons, quotes, percent signs) needs drawtext escaping.
 */
export async function burnCaptions(input: string, spans: readonly CaptionSpan[], out: string): Promise<void> {
  if (!CAPTION_FONT) throw new Error("No caption font found (Arial.ttf or Helvetica.ttc)")
  // A soft dark band behind the lower third (two steps, close to the PNG
  // fallback's gradient) so app content does not compete with the caption.
  const bands = spans.flatMap((span) => [
    `drawbox=x=0:y=ih-200:w=iw:h=80:color=0x0a0a0a@0.4:t=fill:enable='${window_(span)}'`,
    `drawbox=x=0:y=ih-120:w=iw:h=120:color=0x0a0a0a@0.78:t=fill:enable='${window_(span)}'`,
  ])
  const filters = spans.map((span) =>
    [
      `drawtext=fontfile=${escapeFilterValue(CAPTION_FONT)}`,
      `textfile=${escapeFilterValue(span.textFile)}`,
      "expansion=none",
      "fontsize=40",
      "fontcolor=white",
      "line_spacing=12",
      "text_align=C",
      "box=1",
      "boxcolor=black@0.95",
      "boxborderw=22|34",
      "x=(w-text_w)/2",
      "y=h-text_h-58",
      `enable='${window_(span)}'`,
    ].join(":")
  )
  const graph = filters.length > 0 ? [...bands, ...filters].join(",") : "null"
  await ffmpeg(["-i", input, "-vf", graph, ...ENCODE, "-movflags", "+faststart", out])
}

export interface ProbeResult {
  readonly duration: number
  readonly width: number
  readonly height: number
  readonly codec: string
  readonly pixFmt: string
  readonly frameRate: string
  readonly audioStreams: number
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ])
  const parsed = JSON.parse(stdout) as {
    format: { duration: string }
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string }[]
  }
  const video = parsed.streams.find((stream) => stream.codec_type === "video")
  if (!video) throw new Error(`${file} has no video stream`)
  return {
    duration: Number.parseFloat(parsed.format.duration),
    width: video.width ?? 0,
    height: video.height ?? 0,
    codec: video.codec_name,
    pixFmt: video.pix_fmt ?? "",
    frameRate: video.r_frame_rate ?? "",
    audioStreams: parsed.streams.filter((stream) => stream.codec_type === "audio").length,
  }
}

/** One PNG at `at` seconds. */
export async function extractFrame(video: string, at: number, out: string): Promise<void> {
  await ffmpeg(["-ss", at.toFixed(3), "-i", video, "-frames:v", "1", out])
}
