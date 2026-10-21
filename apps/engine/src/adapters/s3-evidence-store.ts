/**
 * Evidence packs and Open EVV exports in S3 (the media bucket, under the
 * `evidence/` and `evv/` prefixes the exporter chooses). The bucket's
 * default SSE-KMS encryption applies to every object.
 */
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"

import type { EvidenceStore } from "../lib/ports"

export function createS3EvidenceStore(options: {
  s3: Pick<S3Client, "send">
  bucket: string
}): EvidenceStore {
  return {
    async put(key, body) {
      await options.s3.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
        })
      )
    },
  }
}
