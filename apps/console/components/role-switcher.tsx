"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  CalendarCheckIcon,
  ClipboardCheckIcon,
  HeartHandshakeIcon,
  UserRoundIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { toast } from "@workspace/ui/components/toast"

import type { Role } from "@/lib/roles"
import { ROLE_DESCRIPTIONS, ROLE_LABELS, roleHome } from "@/lib/roles"

const ROLE_ICONS: Record<Role, typeof CalendarCheckIcon> = {
  scheduler: CalendarCheckIcon,
  compliance: ClipboardCheckIcon,
  family: HeartHandshakeIcon,
  caregiver: UserRoundIcon,
}

const ROLE_ORDER: Role[] = ["scheduler", "compliance", "family", "caregiver"]

export function RoleSwitcher({ current }: { current: Role | null }) {
  const router = useRouter()
  const [pending, setPending] = useState<Role | null>(null)

  async function signIn(role: Role) {
    setPending(role)
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
    if (!response.ok) {
      setPending(null)
      toast.add({ type: "error", title: "Sign In Failed", description: "Try again." })
      return
    }
    toast.add({
      type: "success",
      title: `Signed In As ${ROLE_LABELS[role]}`,
      description: ROLE_DESCRIPTIONS[role],
    })
    router.push(roleHome(role))
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {ROLE_ORDER.map((role) => {
        const Icon = ROLE_ICONS[role]
        return (
          <Card key={role} className="py-4">
            <CardHeader>
              <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
              <CardTitle>{ROLE_LABELS[role]}</CardTitle>
              <CardDescription>{ROLE_DESCRIPTIONS[role]}</CardDescription>
              <CardAction>
                <Button
                  onClick={() => signIn(role)}
                  disabled={pending !== null || current === role}
                >
                  {current === role ? "Current Session" : "Sign In"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Opens {roleHome(role)}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
