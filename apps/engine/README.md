# @visitproof/engine

Lambda handlers for the Presence Engine runtime: `event-processor` (DynamoDB Streams), `visit-sweeper` (EventBridge every minute), `narrative-writer` (Bedrock Nova 2 Lite with Guardrails), `snapshot-fetcher` (Ring snapshot to S3, Rekognition labels on the cropped copy), `exporter` (PDF via `@react-pdf/renderer`, Open EVV JSON), `mailer` (React Email over SES).

Domain logic stays in `@visitproof/domain`; this app wires AWS clients around it. Build with `pnpm build` (tsup, ESM, Node 22).
