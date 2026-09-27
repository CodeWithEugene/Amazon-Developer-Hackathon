# @visitproof/webhooks

Receiver for the Ring Webhook URL. Reads the raw body, verifies `X-Signature` (`sha256=` HMAC-SHA256) with `@visitproof/ring-partner-sdk`, returns 401 on failure, dedupes on `meta.request_id` with a conditional put, persists a `DoorEvent`, and returns 202 in well under the 5 second budget. DynamoDB Streams trigger the engine.

- `src/index.ts` builds the Hono app (`createApp`).
- `src/server.ts` local development server (`pnpm dev`, port 3101).
- `src/lambda.ts` Lambda entry (`handler`) built by `pnpm build` into `dist/`.
