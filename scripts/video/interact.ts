/**
 * Unhurried, visible interactions for the demo recording: a drawn cursor
 * that glides to each target, eased scrolling, and slow typing. Playwright's
 * own showActions overlay is not used because it also prints action titles.
 */
import type { Frame, Locator, Page } from "@playwright/test"

/** A page, or a frame inside one (the phone scene runs in an iframe). */
type Surface = Page | Frame

/**
 * Injected before every document: zooms the page (Playwright records the
 * CSS viewport, so device scale factors do not sharpen the video; html zoom
 * does), hides dev overlays and scrollbars, lifts toasts above the caption
 * band, draws a cursor, and shifts the page clock by the same offset as
 * the demo's Node processes (clock-shift.cjs). Inside a
 * zoomed html, fixed positions are multiplied by the zoom, so the cursor
 * divides event coordinates by it.
 */
export function pageInitScript(zoom: number, clockOffsetMs = 0, extraCss = ""): string {
  const size = Math.round(30 / zoom)
  return `(() => {
  if (location.protocol === "file:") return;
  const clockOffset = ${Number(clockOffsetMs)};
  if (clockOffset !== 0 && !window.__vpClockShifted) {
    const RealDate = Date;
    const shiftedNow = () => RealDate.now() + clockOffset;
    window.Date = new Proxy(RealDate, {
      construct: (target, args, newTarget) => Reflect.construct(target, args.length === 0 ? [shiftedNow()] : args, newTarget),
      apply: () => new RealDate(shiftedNow()).toString(),
      get: (target, property, receiver) => (property === "now" ? shiftedNow : Reflect.get(target, property, receiver)),
    });
    window.__vpClockShifted = true;
  }
  const zoom = ${Number(zoom)};
  const css = [
    zoom !== 1 ? "html{zoom:" + zoom + "!important}" : "",
    "nextjs-portal{display:none!important}",
    "[data-slot=toast-viewport]{bottom:112px!important}",
    "html{scrollbar-width:none!important}",
    "::-webkit-scrollbar{display:none!important}",
    "#vp-cursor{position:fixed;left:0;top:0;width:${size}px;height:${size}px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s}",
    "#vp-cursor svg{width:${size}px;height:${size}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}",
    "#vp-cursor .ring{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.9);opacity:0;transform:scale(.4)}",
    "#vp-cursor.click .ring{animation:vp-click .45s ease-out}",
    "@keyframes vp-click{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}",
    ${JSON.stringify(extraCss)}
  ].join("");
  const svg = '<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const place = (el, x, y) => { el.style.transform = "translate(" + x / zoom + "px," + y / zoom + "px)"; };
  // The style goes in as an adopted sheet and the cursor only after the page
  // has loaded and hydrated, so neither adds a node React did not render.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch (error) { void error; }
  let mounted = false;
  const ensure = () => {
    if (!mounted || !document.body) return;
    if (!document.getElementById("vp-cursor")) {
      const cursor = document.createElement("div");
      cursor.id = "vp-cursor";
      cursor.innerHTML = '<span class="ring"></span>' + svg;
      document.body.appendChild(cursor);
      try {
        const saved = JSON.parse(sessionStorage.getItem("vp-cursor") || "null");
        if (saved) { place(cursor, saved.x, saved.y); cursor.style.opacity = "1"; }
      } catch (error) { void error; }
    }
  };
  const mount = () => setTimeout(() => {
    mounted = true;
    ensure();
    new MutationObserver(ensure).observe(document.body, { childList: true });
  }, 250);
  if (document.readyState === "complete") mount(); else window.addEventListener("load", mount, { once: true });
  document.addEventListener("mousemove", (event) => {
    try { sessionStorage.setItem("vp-cursor", JSON.stringify({ x: event.clientX, y: event.clientY })); } catch (error) { void error; }
    ensure();
    const cursor = document.getElementById("vp-cursor");
    if (!cursor) return;
    place(cursor, event.clientX, event.clientY);
    cursor.style.opacity = "1";
  }, true);
  document.addEventListener("mousedown", () => {
    const cursor = document.getElementById("vp-cursor");
    if (!cursor) return;
    cursor.classList.remove("click");
    void cursor.offsetWidth;
    cursor.classList.add("click");
  }, true);
})();`
}

export const pause = (page: Surface, ms: number): Promise<void> =>
  page.waitForTimeout(ms)

const cursorAt = new WeakMap<Page, { x: number; y: number }>()

/** Puts the cursor at a resting point before the scene starts. */
export async function parkCursor(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y)
  cursorAt.set(page, { x, y })
}

/** Glides the drawn cursor to the centre of `target`. */
export async function glideTo(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error("glideTo: target has no bounding box")
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const from = cursorAt.get(page) ?? { x: to.x + 220, y: to.y + 140 }
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(12, Math.min(45, Math.round(distance / 18)))
  await page.mouse.move(from.x, from.y)
  await page.mouse.move(to.x, to.y, { steps })
  cursorAt.set(page, to)
}

/** Glides the drawn cursor to a point in the viewport (CSS pixels of the unzoomed page). */
export async function glideToPoint(page: Page, x: number, y: number): Promise<void> {
  const from = cursorAt.get(page) ?? { x, y }
  await page.mouse.move(from.x, from.y)
  await page.mouse.move(x, y, { steps: 24 })
  cursorAt.set(page, { x, y })
}

/** Moves to `target`, lingers briefly, then clicks it. */
export async function glideClick(
  page: Page,
  target: Locator,
  lingerMs = 450
): Promise<void> {
  await glideTo(page, target)
  await pause(page, lingerMs)
  const box = await target.boundingBox()
  if (!box) throw new Error("glideClick: target vanished")
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Eased window scroll by `dy` CSS pixels over `ms`. */
export async function scrollBy(page: Surface, dy: number, ms: number): Promise<void> {
  // A source string, not a closure: tsx would wrap named closures in a
  // __name helper that does not exist in the page.
  await page.evaluate(`new Promise((resolve) => {
    const delta = ${Number(dy)}, duration = ${Number(ms)};
    const start = window.scrollY;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const max = document.documentElement.scrollHeight * zoom - window.innerHeight;
    const end = Math.max(0, Math.min(max, start + delta));
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + (end - start) * ease(t));
      if (t < 1) requestAnimationFrame(step); else resolve(true);
    };
    requestAnimationFrame(step);
  })`)
}

/** Eased scroll that brings `target` to `marginTop` CSS pixels below the viewport top. */
export async function scrollToTarget(
  page: Surface,
  target: Locator,
  ms: number,
  marginTop = 90
): Promise<void> {
  const top = await target.evaluate((el) => el.getBoundingClientRect().top)
  await scrollBy(page, top - marginTop, ms)
}

export async function scrollToTop(page: Surface, ms: number): Promise<void> {
  const y = await page.evaluate(() => window.scrollY)
  await scrollBy(page, -y, ms)
}

/** Types like a person: one character at a time. */
export async function typeSlowly(target: Locator, text: string, delayMs = 45): Promise<void> {
  await target.pressSequentially(text, { delay: delayMs })
}
