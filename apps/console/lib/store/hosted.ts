/** Hosted demo flags safe to import anywhere (no filesystem access). */

export const isHostedDemo = (): boolean => process.env.VISITPROOF_HOSTED_DEMO === "1"

export const ASK_HOSTED_UNAVAILABLE =
  "Ask VisitProof needs the VisitProof MCP server, which this hosted demo does not run. Clone the repository and run pnpm demo to ask questions against the same sample data."
