# @visitproof/infra

AWS CDK v2 (TypeScript) app. `bin/app.ts` instantiates one stack per environment; `lib/` holds the stacks listed in `docs/build.md` Section 7 (data, auth, webhooks, engine, mcp, hosting, observability).

Commands (run from `infra/` with AWS credentials in the shell): `pnpm synth`, `pnpm deploy`, `pnpm destroy`. Everything is torn down between sessions except DynamoDB, S3, Cognito, and Amplify.
