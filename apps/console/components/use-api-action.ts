"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { toast } from "@workspace/ui/components/toast"

export interface ApiActionOptions {
  method?: "POST" | "PATCH" | "DELETE"
  body?: unknown
  success: { title: string; description: string }
  failureTitle?: string
}

/**
 * Sends a JSON mutation, shows a toast for the outcome, and refreshes the
 * server components on success. Returns whether the call succeeded.
 */
export function useApiAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run(url: string, options: ApiActionOptions): Promise<boolean> {
    const failureTitle = options.failureTitle ?? "Action Failed"
    setBusy(true)
    try {
      const response = await fetch(url, {
        method: options.method ?? "POST",
        ...(options.body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(options.body),
            }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        toast.add({
          type: "error",
          title: failureTitle,
          description: payload?.error ?? "Try again.",
        })
        return false
      }
      toast.add({ type: "success", ...options.success })
      router.refresh()
      return true
    } catch {
      toast.add({
        type: "error",
        title: failureTitle,
        description: "Network error. Check your connection and try again.",
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  return { busy, run }
}
