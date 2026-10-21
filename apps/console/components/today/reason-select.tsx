"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { RESOLVE_REASONS } from "@/lib/labels"

export const DEFAULT_REASON = RESOLVE_REASONS[0].value

const ITEMS = RESOLVE_REASONS.map((r) => ({ value: r.value, label: r.label }))

export function ReasonSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select
      items={ITEMS}
      value={value}
      onValueChange={(next) => onChange(next ?? DEFAULT_REASON)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
