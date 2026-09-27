/** Roles available for one-click mock sign-in. */
export type Role = "scheduler" | "compliance" | "family" | "caregiver"

export const ROLES: readonly Role[] = ["scheduler", "compliance", "family", "caregiver"]

export const ROLE_HOME: Record<Role, string> = {
  scheduler: "/agency/today",
  compliance: "/agency/compliance",
  family: "/family",
  caregiver: "/me",
}

export const ROLE_LABELS: Record<Role, string> = {
  scheduler: "Scheduler",
  compliance: "Compliance Lead",
  family: "Family Member",
  caregiver: "Caregiver",
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  scheduler: "Run today's board and clear exceptions.",
  compliance: "Reconcile EVV records and export evidence.",
  family: "See one calm daily message and control consent.",
  caregiver: "Review your visit record and add notes.",
}

export function roleHome(role: Role): string {
  return ROLE_HOME[role]
}

export function isRole(value: string | undefined): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value)
}
