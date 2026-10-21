"use client"

import { CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

const SHORT = 10

/** A shortened hash that copies the full value when clicked. */
export function CopyHash({ label, value }: { label: string; value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.add({ type: "success", title: "Hash Copied", description: `${label} copied to the clipboard.` })
    } catch {
      toast.add({
        type: "error",
        title: "Copy Failed",
        description: "The browser blocked clipboard access. Select the hash in the PDF instead.",
      })
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="font-mono"
            onClick={copy}
            aria-label={`Copy full ${label.toLowerCase()} ${value}`}
          />
        }
      >
        {value.length > SHORT ? `${value.slice(0, SHORT)}...` : value}
        <CopyIcon data-icon="inline-end" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>Copy Full {label}</TooltipContent>
    </Tooltip>
  )
}
