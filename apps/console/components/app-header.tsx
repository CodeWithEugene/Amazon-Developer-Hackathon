"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { LogOutIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/toast"

import { isActivePath, ROLE_NAV, type NavItem } from "@/lib/nav"
import { ROLE_LABELS } from "@/lib/roles"
import type { Role } from "@/lib/roles"

export function AppHeader({
  role,
  nav,
}: {
  role: Role
  /** Defaults to the role's navigation (lib/nav.ts). */
  nav?: NavItem[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, setPending] = useState(false)
  const items = nav ?? ROLE_NAV[role]

  async function signOut() {
    setPending(true)
    try {
      const response = await fetch("/api/session", { method: "DELETE" })
      if (!response.ok) throw new Error(`Sign out failed with ${response.status}`)
      toast.add({ type: "info", title: "Signed Out", description: "Session ended." })
      router.push("/")
    } catch {
      setPending(false)
      toast.add({ type: "error", title: "Sign Out Failed", description: "Try again." })
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="font-semibold tracking-tight">
          VisitProof
        </Link>
        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            <span className="sr-only">Signed in as </span>
            {ROLE_LABELS[role]}
          </span>
          <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
            <LogOutIcon data-icon="inline-start" aria-hidden="true" />
            Sign Out
          </Button>
        </div>
        {items.length > 0 ? (
          <nav
            aria-label="Main"
            className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-2 sm:w-auto"
          >
            {items.map((item) => {
              const active = item.active ?? isActivePath(item.href, pathname)
              return (
                <Button
                  key={item.href}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  render={<Link href={item.href} />}
                  nativeButton={false}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Button>
              )
            })}
          </nav>
        ) : null}
      </div>
    </header>
  )
}
