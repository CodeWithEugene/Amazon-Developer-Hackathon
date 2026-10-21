# @visitproof/mcp

The VisitProof MCP server: Express plus `@modelcontextprotocol/sdk` 1.x over Streamable HTTP (protocol versions 2025-03-26 and 2025-11-25). Ask VisitProof (`/ask` in the console), the Strands copilot, and any MCP client such as Alexa+ talk to it at `/mcp`.

## Run

```bash
pnpm --filter @visitproof/mcp dev          # http://127.0.0.1:8000/mcp
VISITPROOF_DEMO_STORE_PATH=.demo-data pnpm --filter @visitproof/mcp dev   # read and write the seeded demo store
pnpm mcp:conformance                        # conformance suite (from the repo root)
```

| Variable | Default | Meaning |
|---|---|---|
| `MCP_PORT` | `8000` | Listen port |
| `MCP_HOST` | `127.0.0.1` | Bind address; set `0.0.0.0` for AgentCore Runtime |
| `VISITPROOF_DEMO_STORE_PATH` | unset | Local store directory. Unset means the in-memory fixture world with the clock frozen at 2026-09-27 12:00 PM ET |
| `VISITPROOF_DEMO_AGENCY_ID` | `a1` | Agency served from the store; its time zone and tolerances come from the store's `agency.json` |
| `VISITPROOF_MODE` | `demo` | Demo tokens are honored only in `demo` |
| `MCP_DEMO_TOKENS` | `family-demo-token=family:cli_okoro,agency-demo-token=agency` | `token=scope` entries; scope is `agency` or `family:<clientId>`. The two bare legacy names keep those scopes; any other unscoped entry is a startup error |
| `MCP_ALLOW_ANONYMOUS` | unset | `1` in demo mode treats token-less requests as the agency (local debugging only) |
| `MCP_PUBLIC_URL` | derived from the request | Canonical resource URL in the protected-resource metadata; its host joins the Host allow-list |
| `MCP_AUTH_ISSUER` | unset | Listed in `authorization_servers` of the metadata |
| `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS` | unset | Extra Host names and Origins to allow (comma separated) |
| `MCP_STATELESS` | unset | `true` for serverless: a fresh server per POST, JSON responses, no sessions, GET and DELETE answer 405 |

## Tools, Resources, Prompt

All tools return a `spoken` string (under 40 words, at most five items, agency-local times such as `8:04 AM ET`), a matching text block, and `structuredContent` validated against an `outputSchema`. Scope and lookup failures are `isError` results. Annotations are honest: reads are `readOnlyHint`, writes are not, and `acknowledge_exception` is `destructiveHint`.

| Tool | Scope | Behavior |
|---|---|---|
| `get_visit_status` | family (own client), agency | Every visit of the day. The door is always "someone"; a caregiver is named only from their own clock-in. Unobservable, not-yet-due, and awaiting visits are answered as such |
| `list_visits` | family (own client), agency | Visits on a date, optional status and client |
| `list_exceptions` | agency | Exceptions for visits scheduled in the window (default today, open), ranked by severity. `state: "any"`, `kind`, and `days` answer "who was late this week" |
| `explain_visit` | family (own client), agency | Observed, Reported, and Resolved timeline with provenance and the signed ledger records |
| `get_client_summary` | family (own client), agency | On time, late (from the door arrival), no-shows, and unobservable visits over a week, two weeks, or a month |
| `acknowledge_exception` | agency | Resolves an open exception with a reason and signs a Resolved ledger record |
| `add_visit_note` | family (own client), agency | Saves a note and signs a Reported ledger record |

Writes need confirmation: the server uses elicitation when the client declares it, and otherwise returns `status: "confirmation_required"` until the call is repeated with `confirmed: true` (the Alexa+ client declares no elicitation). `confirmed: false` declines. Records are signed with the local HMAC stand-in for KMS in demo mode, the same key id the console verifies.

Agency views hide visit details when the family turned off `consent.shareWithAgency` (contract C3).

Resources: `visitproof://schedule/{clientId}/{date}` (JSON, listed per visible client for today) and `visitproof://feed/{clientId}/today` (text). Prompt: `morning_briefing(clientId?)`.

## Security

- `POST/GET/DELETE /mcp` check Host and Origin before anything else: a Host outside the allow-list or an Origin outside the allowed origins gets 403 (DNS-rebinding protection). Requests without an Origin, such as server-side clients, pass the Origin check.
- Unauthenticated requests get 401 with `WWW-Authenticate: Bearer realm="visitproof", resource_metadata="<origin>/.well-known/oauth-protected-resource"`, plus `error="invalid_token"` when a token was presented. `GET /.well-known/oauth-protected-resource` (and `/mcp` suffixed) serve RFC 9728 metadata.
- A session is bound to the credential that created it; another token on the same session id gets 403. Sessions expire after 30 idle minutes and at most 100 are kept (least recently used is closed first).
- Not implemented yet: Cognito JWT verification. In live mode demo tokens are refused, so `/mcp` answers 401 until a verifier is passed to `createHttpApp({ verifyAccessToken })`. `/.well-known/oauth-authorization-server` is not served.

## Layout

- `src/index.ts` `createHttpApp()` and `createMcpServer()`; `src/server.ts` the entry point.
- `src/tools/` one module per tool family, `register.ts` for registration, `resources.ts` for resources and the prompt.
- `src/db-repo.ts` adapts `@visitproof/db` (local store or DynamoDB) to the tools, selecting visits by agency-local date. `src/memory-store.ts` plus `src/fixtures.ts` provide the fixture world in the same shape as the `pnpm demo` seed.
- `src/auth.ts`, `src/auth-http.ts`, `src/security.ts`, `src/sessions.ts` for tokens, the 401 and metadata, Origin and Host checks, and the session table.
- `test/tools.test.ts` handlers on the fixture world; `test/db-repo.test.ts` the same tools against a temp-directory local store; `test/conformance/` transport, auth, scopes, Origin and Host, SDK client with elicitation, and stateless mode; `test/golden.json` golden utterances checked by `apps/copilot`.
