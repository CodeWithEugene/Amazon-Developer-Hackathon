/**
 * Preloaded into every Node process of the recorder's demo (through
 * NODE_OPTIONS=--require) so the whole stack agrees on a simulated "now":
 * the evening of the seeded day, after every replayed visit has settled.
 * Without it, notes and PDFs are stamped with the wall clock (late morning)
 * while today's afternoon visits already show as settled.
 *
 * VP_VIDEO_CLOCK_OFFSET_MS is added to every reading of the current time.
 * Dates built from explicit values are untouched, and timers and
 * performance.now() keep running in real time.
 */
"use strict"

const offset = Number(process.env.VP_VIDEO_CLOCK_OFFSET_MS)

if (Number.isFinite(offset) && offset !== 0 && !globalThis.__vpClockShifted) {
  const RealDate = Date
  const realNow = RealDate.now.bind(RealDate)
  const shiftedNow = () => realNow() + offset
  const ShiftedDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return args.length === 0
        ? Reflect.construct(target, [shiftedNow()], newTarget)
        : Reflect.construct(target, args, newTarget)
    },
    apply() {
      return new RealDate(shiftedNow()).toString()
    },
    get(target, property, receiver) {
      if (property === "now") return shiftedNow
      return Reflect.get(target, property, receiver)
    },
  })
  globalThis.Date = ShiftedDate
  globalThis.__vpClockShifted = true
}
