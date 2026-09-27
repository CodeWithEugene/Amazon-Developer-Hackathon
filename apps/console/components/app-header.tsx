"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { LogOutIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/toast"

import { ROLE_LABELS } from "@/lib/roles"
import type { Role } from "@/lib/roles"

export function AppHeader({
  role,
  nav,
}: {
  role: Role
  nav?: { href: string; label: string; active?: boolean }[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    await fetch("/api/session", { method: "DELETE" })
    toast.add({ type: "info", title: "Signed Out", description: "Session ended." })
    router.push("/")
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <p className="font-semibold tracking-tight">VisitProof</p>
        {nav?.length ? (
          <nav aria-label="Main" className="flex items-center gap-1">
            {nav.map((item) => (
              <Button
                key={item.href}
                variant={item.active ? "secondary" : "ghost"}
                size="sm"
                onClick={() => router.push(item.href)}
              >
                {item.label}
              </Button>
            ))}
          </nav>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground" aria-label={`Signed in as ${ROLE_LABELS[role]}`}>
            {ROLE_LABELS[role]}
          </span>
          <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
            <LogOutIcon data-icon="inline-start" aria-hidden="true" />
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  )
}
