"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { HistoryIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

interface SyncResponse {
  readonly result?: { readonly saved: number; readonly alreadyStored: number; readonly fetched: number }
  readonly provenance?: string
  readonly error?: string
}

/** Pulls Ring history since consent into the household's door record. */
export function SyncHistoryButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function sync() {
    setBusy(true)
    try {
      const response = await fetch("/api/ring/history", { method: "POST", headers: { "Content-Type": "application/json" } })
      const body = (await response.json().catch(() => ({}))) as SyncResponse
      if (!response.ok || !body.result) {
        toast.add({ type: "error", title: "Could Not Sync Ring History", description: body.error ?? "Try again." })
        return
      }
      toast.add({
        type: "success",
        title: "Ring History Synced",
        description: `${body.result.saved} new events saved from ${body.provenance ?? "Ring"}. ${body.result.alreadyStored} were already stored.`,
      })
      router.refresh()
    } catch {
      toast.add({ type: "error", title: "Could Not Sync Ring History", description: "Check your connection and try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={sync} disabled={busy}>
      {busy ? <Spinner data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" aria-hidden="true" />}
      Sync Ring History
    </Button>
  )
}
