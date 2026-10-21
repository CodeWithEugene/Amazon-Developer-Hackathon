/**
 * A small, dependency-free PDF writer with real pagination: text lines are
 * word-wrapped to the page width and flowed across as many US Letter pages
 * as needed, with a footer on every page. Standard fonts only (Helvetica,
 * Helvetica-Bold, Courier), WinAnsi text, uncompressed streams so the
 * output is easy to verify.
 */

export type PdfFont = "regular" | "bold" | "mono"

export interface PdfLine {
  text: string
  font?: PdfFont
  size?: number
  indent?: number
  /** Extra space above the line, in points. */
  gapBefore?: number
}

interface PlacedLine {
  text: string
  font: PdfFont
  size: number
  x: number
  y: number
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN_X = 50
const TOP_Y = 742
const BOTTOM_Y = 64
const FOOTER_Y = 36
const LINE_FACTOR = 1.35

/** Average glyph width as a fraction of the font size. */
const WIDTH_FACTOR: Record<PdfFont, number> = {
  regular: 0.52,
  bold: 0.56,
  mono: 0.6,
}

const FONT_RESOURCE: Record<PdfFont, string> = {
  regular: "F1",
  bold: "F2",
  mono: "F3",
}

const REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
  " ": " ",
}

/** Printable ASCII only; anything else becomes a close stand-in or "?". */
export function toPdfText(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.charCodeAt(0)
      if (code >= 0x20 && code <= 0x7e) return char
      return REPLACEMENTS[char] ?? "?"
    })
    .join("")
}

const escapePdf = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")

function hardSplit(word: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (let i = 0; i < word.length; i += maxChars) {
    pieces.push(word.slice(i, i + maxChars))
  }
  return pieces
}

/** Word-wraps one line to at most `maxChars` characters per row. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const rows: string[] = []
  let current = ""
  for (const word of words.flatMap((w) => hardSplit(w, maxChars))) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) rows.push(current)
    current = word
  }
  if (current) rows.push(current)
  return rows.length > 0 ? rows : [""]
}

/** Flows lines onto pages; returns the placed rows of each page. */
export function layoutPages(lines: readonly PdfLine[]): PlacedLine[][] {
  const pages: PlacedLine[][] = [[]]
  let y = TOP_Y
  for (const line of lines) {
    const font = line.font ?? "regular"
    const size = line.size ?? 10
    const indent = line.indent ?? 0
    const leading = size * LINE_FACTOR
    const maxChars = Math.floor(
      (PAGE_WIDTH - 2 * MARGIN_X - indent) / (size * WIDTH_FACTOR[font])
    )
    y -= line.gapBefore ?? 0
    for (const row of wrapText(toPdfText(line.text), maxChars)) {
      if (y - leading < BOTTOM_Y) {
        pages.push([])
        y = TOP_Y
      }
      y -= leading
      pages.at(-1)?.push({ text: row, font, size, x: MARGIN_X + indent, y })
    }
  }
  return pages
}

function pageStream(rows: readonly PlacedLine[], footer: string): string {
  const body = rows.map(
    (row) =>
      `BT /${FONT_RESOURCE[row.font]} ${row.size} Tf ${row.x} ${row.y.toFixed(2)} Td (${escapePdf(row.text)}) Tj ET`
  )
  const foot = `BT /F1 8 Tf ${MARGIN_X} ${FOOTER_Y} Td (${escapePdf(toPdfText(footer))}) Tj ET`
  return [...body, foot].join("\n")
}

/**
 * Renders lines to a paginated PDF. `footer(page, total)` supplies each
 * page's footer text.
 */
export function renderPdf(
  lines: readonly PdfLine[],
  footer: (page: number, total: number) => string
): Uint8Array {
  const pages = layoutPages(lines)
  const fontObjects = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ]
  const firstPageObj = 3 + fontObjects.length
  const pageObjId = (index: number): number => firstPageObj + index * 2
  const resources = "<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >>"
  const pageObjects = pages.flatMap((rows, index) => {
    const stream = pageStream(rows, footer(index + 1, pages.length))
    return [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${pageObjId(index) + 1} 0 R /Resources ${resources} >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ]
  })
  const kids = pages.map((_, index) => `${pageObjId(index)} 0 R`).join(" ")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    ...fontObjects,
    ...pageObjects,
  ]
  return serialize(objects)
}

function serialize(objects: readonly string[]): Uint8Array {
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  const xref = offsets
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("")
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
