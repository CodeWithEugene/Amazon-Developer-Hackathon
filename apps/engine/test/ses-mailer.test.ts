import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses"
import { mockClient } from "aws-sdk-client-mock"
import { afterEach, describe, expect, it } from "vitest"

import { createSesMailTransport } from "../src"
import { silentLogger } from "./helpers"

const ses = mockClient(SESClient)
afterEach(() => ses.reset())

describe("SES mail transport", () => {
  it("always sends from the verified sender", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m-1" })
    const mail = createSesMailTransport({
      client: new SESClient({}),
      fromAddress: "alerts@visitproof.test",
    })
    await mail.send({
      to: "priya@example.com",
      subject: "VisitProof Daily Digest",
      text: "Hello",
    })
    const input = ses.commandCalls(SendEmailCommand)[0]?.args[0].input
    expect(input?.Source).toBe("alerts@visitproof.test")
    expect(input?.Destination?.ToAddresses).toEqual(["priya@example.com"])
    expect(input?.Message?.Subject?.Data).toBe("VisitProof Daily Digest")
  })

  it("skips recipients outside the sandbox allowlist", async () => {
    ses.on(SendEmailCommand).resolves({})
    const logger = silentLogger()
    const mail = createSesMailTransport({
      client: new SESClient({}),
      fromAddress: "alerts@visitproof.test",
      allowedRecipients: ["Priya@Example.com"],
      logger,
    })
    await mail.send({ to: "someone@else.test", subject: "S", text: "T" })
    await mail.send({ to: "priya@example.com", subject: "S", text: "T" })
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1)
    expect(logger.warnings).toHaveLength(1)
  })

  it("rejects an invalid sender at construction", () => {
    expect(() =>
      createSesMailTransport({ client: new SESClient({}), fromAddress: "nope" })
    ).toThrow()
  })
})
