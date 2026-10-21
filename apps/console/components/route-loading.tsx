import { Skeleton } from "@workspace/ui/components/skeleton"

/** Skeleton frame shown while a route's server data loads. */
export function RouteLoading({ cards = 3 }: { cards?: number }) {
  return (
    <div className="flex min-h-svh flex-col bg-background" aria-busy="true">
      <div className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
      </div>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <span className="sr-only" role="status">
          Loading
        </span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </main>
    </div>
  )
}
