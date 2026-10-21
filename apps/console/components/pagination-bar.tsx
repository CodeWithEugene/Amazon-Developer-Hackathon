"use client"

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

/** Client-side paging over an in-memory list. */
export function usePagination<T>(items: readonly T[], pageSize: number) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  return {
    page: current,
    pageCount,
    setPage,
    slice: items.slice(current * pageSize, current * pageSize + pageSize),
  }
}

export function PaginationBar({
  page,
  pageCount,
  total,
  label,
  onPage,
}: {
  page: number
  pageCount: number
  total: number
  label: string
  onPage: (page: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-wrap items-center justify-between gap-2 pt-2"
    >
      <p className="text-sm text-muted-foreground">
        Page {page + 1} of {pageCount}, {total} {label.toLowerCase()}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
          <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
