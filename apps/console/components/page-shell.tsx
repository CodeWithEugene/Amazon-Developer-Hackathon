import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import { AppHeader } from "@/components/app-header"
import type { Role } from "@/lib/roles"

/** Shared page frame: header, page heading, content, and policy footer. */
export function PageShell({
  role,
  title,
  description,
  width = "wide",
  children,
}: {
  role: Role | null
  title: string
  description?: string
  width?: "wide" | "narrow"
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      {role ? <AppHeader role={role} /> : null}
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 py-8",
          width === "wide" ? "max-w-6xl" : "max-w-2xl"
        )}
      >
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted-foreground">
        <span>VisitProof corroborates visits. It is not an EVV system of record.</span>
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
      </div>
    </footer>
  )
}
