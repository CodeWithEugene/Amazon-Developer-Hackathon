import type { Role } from "@/lib/roles"

export interface NavItem {
  href: string
  label: string
  active?: boolean
}

/**
 * Primary navigation per role (contracts C6 and C7): the agency gets its
 * boards and Ask VisitProof; the family gets Device Check, Live View, and
 * Ask VisitProof next to the daily feed.
 */
export const ROLE_NAV: Record<Role, readonly NavItem[]> = {
  scheduler: [
    { href: "/agency/today", label: "Today" },
    { href: "/agency/compliance", label: "Compliance" },
    { href: "/ask", label: "Ask" },
  ],
  compliance: [
    { href: "/agency/today", label: "Today" },
    { href: "/agency/compliance", label: "Compliance" },
    { href: "/ask", label: "Ask" },
  ],
  family: [
    { href: "/family", label: "Home" },
    { href: "/family/devices", label: "Devices" },
    { href: "/family/live", label: "Live View" },
    { href: "/ask", label: "Ask" },
  ],
  caregiver: [{ href: "/me", label: "My Visits" }],
}

/** Whether a nav item is the current page (exact, or a nested route). */
export function isActivePath(href: string, pathname: string): boolean {
  if (pathname === href) return true
  const nested = ["/family", "/me"].includes(href) ? false : pathname.startsWith(`${href}/`)
  return nested
}
