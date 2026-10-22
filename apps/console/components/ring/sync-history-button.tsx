"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { HistoryIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { historySyncNotice, historySyncResponseSchema, type HistorySyncResponse } from "@/lib/ring/history-sync-notice"

/** Pulls Ring history since consent into the household's door record. */
export function SyncHistoryButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function sync() {
    setBusy(true)
    try {
      const response = await fetch("/api/ring/history", { method: "POST", headers: { "Content-Type": "application/json" } })
      const parsed = historySyncResponseSchema.safeParse(await response.json().catch(() => ({})))
      const body: HistorySyncResponse = parsed.success ? parsed.data : {}
      if (!response.ok || !body.result) {
        toast.add({ type: "error", title: "Could Not Sync Ring History", description: body.error ?? "Try again." })
        return
      }
      toast.add(historySyncNotice(body.result, body))
      if (body.result.saved > 0) router.refresh()
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
