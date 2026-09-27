/** Formats an ISO datetime as a short local time, e.g. 10:41 AM. */
export function formatTime(iso: string | undefined): string {
  if (!iso) return "not observed"
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Formats an ISO datetime as a short window, e.g. 7:00 AM to 9:00 AM. */
export function formatWindow(start: string, end: string): string {
  return `${formatTime(start)} to ${formatTime(end)}`
}

/** Formats an ISO date as a long date, e.g. September 27, 2026. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}
