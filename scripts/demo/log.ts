/** Demo console output (stdout for progress, stderr for problems). */
export const log = (step: string, message: string): void => {
  process.stdout.write(`[demo] ${step}: ${message}\n`)
}

export const warn = (step: string, message: string): void => {
  process.stderr.write(`[demo] ${step}: ${message}\n`)
}

/** A failure the person running the demo can act on; printed without a stack. */
export class DemoError extends Error {
  override readonly name = "DemoError"
}
