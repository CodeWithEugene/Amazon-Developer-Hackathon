/**
 * Content-Security-Policy for the console, sent as a response header from
 * next.config.ts (the "Without Nonces" pattern in the Next.js 16 CSP guide).
 *
 * Every request the browser makes is same origin: Ring WHEP signaling and
 * teardown go through /api/ring/stream, and fonts are self hosted by
 * next/font. The live view assigns a MediaStream to <video>.srcObject, which
 * CSP does not gate; media-src still allows blob: and mediastream: so a
 * stream URL never trips the policy. WebRTC peer connections are not
 * governed by CSP.
 *
 * 'unsafe-inline' for scripts covers the inline flight payload Next.js
 * writes into every page and the next-themes boot script; nonces would
 * force every page into dynamic rendering. 'unsafe-eval' is development
 * only (React uses eval to rebuild server error stacks).
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>

const NONE = "'none'"

/** Directives that are valid with no source list. */
const STANDALONE_DIRECTIVES = new Set(["upgrade-insecure-requests", "block-all-mixed-content", "sandbox"])

export const cspDirectives = (options: { readonly dev: boolean }): CspDirectives => ({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", ...(options.dev ? ["'unsafe-eval'"] : [])],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "blob:", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "media-src": ["'self'", "blob:", "mediastream:"],
  "object-src": [NONE],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": [NONE],
})

/** Serializes directives into a single header value, `name src src; ...`. */
export const serializeCsp = (directives: CspDirectives): string =>
  Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ")

export const buildContentSecurityPolicy = (options: { readonly dev: boolean }): string =>
  serializeCsp(cspDirectives(options))

/**
 * Problems a browser would report for a policy string: 'none' combined with
 * other sources (the keyword is then ignored), duplicate directives (later
 * ones are ignored), and empty directives.
 */
export const cspProblems = (policy: string): readonly string[] => {
  const directives = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0)
  const names = directives.map(([name]) => name!.toLowerCase())
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
  return [
    ...directives
      .filter(([, ...sources]) => sources.includes(NONE) && sources.length > 1)
      .map(([name]) => `${name} combines 'none' with other sources`),
    ...duplicates.map((name) => `${name} is declared more than once`),
    ...directives
      .filter((tokens) => tokens.length === 1 && !STANDALONE_DIRECTIVES.has(tokens[0]!.toLowerCase()))
      .map(([name]) => `${name} has no sources`),
  ]
}
