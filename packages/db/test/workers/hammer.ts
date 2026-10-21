/**
 * Child process for the multi-process store test. Hammers one shared local
 * store with visit puts, consent read-modify-writes, and contended webhook
 * receipt claims, then reports which receipts it won as JSON on stdout.
 *
 * argv: <storeDir> <workerId> <count>
 */
import { createLocalRepository } from "../../src"
import { makeClient, makeVisit } from "../fixtures"

const [dir, workerId, countArg] = process.argv.slice(2)
if (dir === undefined || workerId === undefined || countArg === undefined) {
  throw new Error("usage: hammer.ts <storeDir> <workerId> <count>")
}
const count = Number.parseInt(countArg, 10)
const repo = createLocalRepository(dir)

const run = async (): Promise<void> => {
  const won: string[] = []
  for (let i = 0; i < count; i += 1) {
    await repo.visits.put(makeVisit({ id: `visit-${workerId}-${i}` }))
    await repo.clients.put(makeClient({ id: `client-${workerId}-${i}` }))
    if (await repo.webhookReceipts.claim(`req-${i}`, new Date()))
      won.push(`req-${i}`)
  }
  process.stdout.write(`${JSON.stringify({ workerId, won })}\n`)
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${String(error instanceof Error ? error.stack : error)}\n`
  )
  process.exitCode = 1
})
