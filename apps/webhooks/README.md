# @visitproof/webhooks

Receiver for the Ring Webhook URL (`POST /webhooks/ring`, alias `POST /ring/webhook`, plus `GET /health`).

1. Reads the raw body and verifies `X-Signature` (`sha256=` HMAC-SHA256) over the exact bytes; 401 on failure.
2. Parses leniently: known event families strictly; a validly signed delivery with a new `data.type` is archived with its raw type and acknowledged, never 400ed. Only a body that is not JSON or has no request or account id gets 400.
3. Routes the Ring account: a linked client; an account that is not yet linked (UNCLAIMED) goes to the bucket `unclaimed#ring-account#<accountId>` and is moved to the client when the Account Link completes; a client whose `ringLinkStatus` is `removed` is acknowledged with 202 and nothing is stored (contract C3).
4. Persists the `DoorEvent`, then claims the receipt on `meta.request_id` (duplicates are acked as `duplicate`).
5. Returns 202, and only then schedules engine work (contract C5).

Provenance (contract C4): `emulated` only when `VISITPROOF_MODE` is `demo` and the request carries `x-visitproof-provenance: emulated`; otherwise `ring_webhook`.

Environment: `RING_HMAC_SIGNING_KEY`, `VISITPROOF_MODE` (`demo` by default), `VISITPROOF_ENGINE_INLINE` (`true` by default; `false` skips the engine entirely, which the demo uses before replaying the engine in simulated time and which production uses with DynamoDB Streams), `PORT` (local server, default 3101), `VISITPROOF_DEMO_STORE_PATH`, `VISITPROOF_DEMO_AGENCY_ID` (local), `VISITPROOF_AGENCY_ID` (Lambda).

- `src/index.ts` builds the Hono app (`createApp`); `src/receive.ts` is the HTTP-free pipeline.
- `src/server.ts` local development server over the on-disk store; unknown event types are appended to `<store>/webhook-inbox/webhook-unknown-events.jsonl`.
- `src/lambda.ts` Lambda entry (`handler`) built by `pnpm build` into `dist/`.
- `src/engine-hook.ts` wires `@visitproof/engine`'s `ingestDoorEvent` with an injectable clock.
