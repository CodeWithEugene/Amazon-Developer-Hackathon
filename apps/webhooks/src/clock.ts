/** Injected clock so the receiver is fully testable. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()
