import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { AssetHashType, Duration } from "aws-cdk-lib"
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  Runtime,
  type FunctionProps,
} from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import type { Construct } from "constructs"
import { buildSync } from "esbuild"

/** Repository root (infra/lib -> repo). Lambda entries are bundled from here. */
export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
)

const RUNTIME = Runtime.NODEJS_22_X
const OUTPUT_FILE = "index.mjs"
/** ESM output still needs `require` for CommonJS dependencies. */
const REQUIRE_SHIM =
  "import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);"

/**
 * Bundles one entry with the esbuild JS API during synth (no Docker, no
 * network, no package manager lookups): ESM for Node 22, AWS SDK included so
 * the deployed code runs the exact pinned versions from pnpm-lock.yaml.
 */
export const bundledCode = (entry: string): Code => {
  const entryPath = join(REPO_ROOT, entry)
  return Code.fromAsset(dirname(entryPath), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      image: RUNTIME.bundlingImage,
      // Part of the staging cache key: entries sharing a directory must not
      // share a bundle. Never executed (local bundling always succeeds).
      command: ["esbuild", entry],
      local: {
        tryBundle(outputDir) {
          buildSync({
            entryPoints: [entryPath],
            outfile: join(outputDir, OUTPUT_FILE),
            absWorkingDir: REPO_ROOT,
            bundle: true,
            platform: "node",
            target: "node22",
            format: "esm",
            mainFields: ["module", "main"],
            minify: true,
            sourcemap: true,
            legalComments: "none",
            banner: { js: REQUIRE_SHIM },
            logLevel: "error",
          })
          return true
        },
      },
    },
  })
}

export interface VisitProofFunctionProps {
  /** Entry file relative to the repository root; must export `handler`. */
  entry: string
  description: string
  timeout: Duration
  memorySize?: number
  environment?: Record<string, string>
  deadLetterQueue?: FunctionProps["deadLetterQueue"]
}

/** Node 22 on arm64 with two-week log retention. */
export const visitProofFunction = (
  scope: Construct,
  id: string,
  props: VisitProofFunctionProps
): LambdaFunction =>
  new LambdaFunction(scope, id, {
    code: bundledCode(props.entry),
    handler: "index.handler",
    runtime: RUNTIME,
    architecture: Architecture.ARM_64,
    memorySize: props.memorySize ?? 256,
    timeout: props.timeout,
    description: props.description,
    environment: { NODE_OPTIONS: "--enable-source-maps", ...props.environment },
    logGroup: new LogGroup(scope, `${id}Logs`, {
      retention: RetentionDays.TWO_WEEKS,
    }),
    ...(props.deadLetterQueue
      ? { deadLetterQueue: props.deadLetterQueue }
      : {}),
  })
