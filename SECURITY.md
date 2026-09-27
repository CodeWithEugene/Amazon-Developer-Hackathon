# Security Policy

VisitProof processes events about care visits to private homes, Ring account tokens, and (optionally) doorbell snapshots. We treat every report seriously.

## Supported Versions

| Version | Supported |
|---|---|
| `main` branch and the latest tagged release | Yes |
| Anything older | No |

## Reporting a Vulnerability

Please do not open a public GitHub issue for security problems.

- Email: eugenegabriel.ke@gmail.com with the subject line "VisitProof security".
- Include: a description, steps to reproduce, affected component (console, webhook receiver, MCP server, emulator, SDK package), and any proof-of-concept. Never include real customer data, real Ring tokens, or real media.
- You will receive an acknowledgement within 3 business days and a status update at least every 7 days until resolution.
- We ask for 90 days of coordinated disclosure. We will credit reporters in the release notes unless you prefer otherwise.

## Scope

In scope:

- Ring webhook receiver (HMAC verification, idempotency, replay protection)
- OAuth token exchange, refresh, storage, and account-linking nonce handling
- The MCP server (authorization, session handling, tool input validation, Origin validation)
- The web console and family portal (authentication, authorization between agency, family, and caregiver roles, data exposure)
- Evidence export signing and verification
- The `@visitproof/ring-partner-sdk` package and the emulator

Out of scope:

- Vulnerabilities in Ring, Amazon, or AWS services themselves (report those to the vendor)
- Denial-of-service against demo infrastructure
- Findings that require a compromised developer machine or leaked credentials

## Security Design Notes

- Ring tokens are stored encrypted with AWS KMS envelope encryption and are never sent to the browser.
- Webhooks are verified over the raw request body with a constant-time comparison; requests are deduplicated on `meta.request_id`; unverified requests are rejected with 401 and never processed.
- The MCP endpoint validates `Origin`, requires a bearer token, binds all state to the token subject rather than the session id, and returns tool execution errors rather than leaking stack traces.
- Snapshots are optional, family-controlled, stored with lifecycle expiry, and never used for identity inference.
- Synthetic personas only: no real people, addresses, or footage exist in this repository.

## Dependencies

Run `pnpm audit` before releases. Dependabot is enabled for npm and GitHub Actions. Secrets are never committed; see `.env.example` for the variables required and `.gitignore` for the protected paths.
