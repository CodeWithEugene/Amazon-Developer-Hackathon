/**
 * Title cards as standalone 1920x1080 HTML pages in the console's dark
 * palette (packages/ui/src/styles/globals.css, .dark). Playwright renders
 * each one to a PNG, and ffmpeg turns the PNG into a clip.
 */
import type { CardContent } from "./scenes"

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const STYLE = `
:root {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 10%);
  --success: oklch(0.52 0.14 150);
  --warning: oklch(0.41 0.11 46);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body {
  background:
    radial-gradient(ellipse 70% 60% at 50% 0%, oklch(0.24 0 0) 0%, transparent 70%),
    var(--background);
  color: var(--foreground);
  font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column; justify-content: center;
  padding: 0 160px;
}
.brand { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; color: var(--muted-foreground); position: absolute; top: 72px; left: 160px; }
.dot { display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: var(--success); margin-right: 14px; vertical-align: 2px; }
h1 { font-size: 168px; font-weight: 700; letter-spacing: -0.045em; line-height: 1; }
.tagline { text-wrap: balance; font-size: 52px; line-height: 1.25; color: var(--muted-foreground); margin-top: 40px; max-width: 1400px; }
.pills { display: flex; gap: 20px; margin-top: 80px; }
.pill { font-size: 32px; font-weight: 500; padding: 16px 32px; border-radius: 999px; border: 1px solid var(--border); background: var(--card); }
.eyebrow { font-size: 34px; font-weight: 600; text-transform: none; color: var(--muted-foreground); margin-bottom: 56px; letter-spacing: 0.01em; }
.statements { display: flex; flex-direction: column; gap: 44px; }
.statement { text-wrap: balance; font-size: 60px; font-weight: 600; line-height: 1.18; letter-spacing: -0.02em; padding-left: 40px; border-left: 6px solid var(--warning); }
h2 { font-size: 76px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 64px; }
.columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; }
.column { background: var(--card); border: 1px solid var(--border); border-radius: 28px; padding: 44px 44px 48px; }
.column h3 { font-size: 42px; font-weight: 650; margin-bottom: 28px; }
.column { transition: none; }
.column.dim { opacity: 0.32; }
.column.focus { border-color: oklch(0.52 0.14 150 / 70%); box-shadow: 0 0 0 2px oklch(0.52 0.14 150 / 35%); }
.column li { text-wrap: balance; list-style: none; font-size: 32px; line-height: 1.3; color: var(--muted-foreground); padding: 12px 0; border-top: 1px solid var(--border); }
.closing { text-wrap: balance; font-size: 74px; font-weight: 650; line-height: 1.15; letter-spacing: -0.03em; max-width: 1500px; }
.link { margin-top: 72px; font-size: 40px; font-weight: 500; letter-spacing: 0.01em; color: var(--foreground); padding: 20px 32px; border: 1px solid var(--border); border-radius: 18px; background: var(--card); align-self: flex-start; }
`

function body(card: CardContent, focus: number | undefined): string {
  switch (card.layout) {
    case "hero":
      return `
<h1>${escapeHtml(card.title)}</h1>
<p class="tagline">${escapeHtml(card.tagline)}</p>
<div class="pills">${card.pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join("")}</div>`
    case "statements":
      return `
<div class="brand"><span class="dot"></span>VisitProof</div>
<p class="eyebrow">${escapeHtml(card.eyebrow)}</p>
<div class="statements">${card.lines.map((line) => `<p class="statement">${escapeHtml(line)}</p>`).join("")}</div>`
    case "columns":
      return `
<div class="brand"><span class="dot"></span>VisitProof</div>
<h2>${escapeHtml(card.title)}</h2>
<div class="columns">${card.columns
        .map(
          (column, index) => `
  <section class="column${focus === undefined ? "" : index === focus ? " focus" : " dim"}"><h3>${escapeHtml(column.heading)}</h3>
    <ul>${column.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </section>`
        )
        .join("")}</div>`
    case "closing":
      return `
<div class="brand"><span class="dot"></span>VisitProof</div>
<p class="closing">${escapeHtml(card.statement)}</p>
<p class="link">${escapeHtml(card.link)}</p>`
  }
}

/**
 * One card page. For the columns layout, `focus` highlights one column and
 * dims the others, so the card can walk through them one at a time.
 */
export function cardHtml(title: string, card: CardContent, focus?: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>${body(card, focus)}
</body>
</html>
`
}

/** Characters that must never reach the screen (house style: no em or en dashes). */
export const FORBIDDEN_DASHES = /[\u2013\u2014]/

/**
 * A transparent 1920x1080 page holding one lower-third caption, used when
 * the local ffmpeg has no drawtext filter (Homebrew's default build lacks
 * libfreetype). Same look as the drawtext pass: Arial 40 px, white on a
 * 95 percent black box, centred near the bottom edge, over a soft dark band
 * so app content behind the lower third does not compete with it.
 */
export function captionHtml(caption: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Caption</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
body {
  background: linear-gradient(to top, rgba(10, 10, 10, 0.86) 0, rgba(10, 10, 10, 0.72) 120px, rgba(10, 10, 10, 0) 200px);
}
body { display: flex; align-items: flex-end; justify-content: center; padding-bottom: 36px; }
p {
  max-width: 1500px; text-align: center;
  font-family: Arial, Helvetica, sans-serif; font-size: 40px; line-height: 1.3; color: #fff;
  background: rgba(0, 0, 0, 0.95); padding: 18px 34px; border-radius: 10px;
}
</style>
</head>
<body><p>${escapeHtml(caption)}</p></body>
</html>
`
}
