import { describe, expect, it } from "vitest"

import {
  DEFAULT_DETAIL_TAB,
  describeReasoning,
  joinNames,
  PROTOCOL_NOTE,
  toolTitle,
  traceDetailLabel,
  traceStepLabel,
} from "@/lib/ask-reasoning"

const fixture = (reasoning: string, toolNames: string[]) =>
  describeReasoning({ brainLabel: "Fixture Brain", reasoning, toolNames })

describe("Ask VisitProof reasoning copy", () => {
  it("drops the intent token and names the chosen tool", () => {
    const text = fixture(
      "visit_status: asks whether the caregiver came; get_visit_status covers every visit of the day",
      ["get_visit_status"]
    )
    expect(text).toBe("Fixture Brain chose Visit Status: it covers every visit of the day.")
  })

  it("reads as one clause when the rationale continues with a linking word", () => {
    expect(fixture("schedule: asks about the schedule; list_visits for the date", ["list_visits"])).toBe(
      "Fixture Brain chose Visits for the date."
    )
    expect(fixture("summary: asks how visits have gone; get_client_summary over the range", ["list_visits", "get_client_summary"])).toBe(
      "Fixture Brain chose Visits and Client Summary: Client Summary over the range."
    )
  })

  it("never shows a raw snake_case tool name", () => {
    const text = fixture(
      "visit_status: asks whether the caregiver came; get_visit_status covers every visit of the day",
      ["get_visit_status"]
    )
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
  })

  it("titles known and unknown tool names", () => {
    expect(toolTitle("get_visit_status")).toBe("Visit Status")
    expect(toolTitle("add_visit_note")).toBe("Visit Note")
    expect(toolTitle("list_care_plans")).toBe("Care Plans")
    expect(toolTitle("ping")).toBe("Ping")
  })

  it("humanizes snake_case words that are not tool names", () => {
    const text = fixture(
      "lateness: agency asks who was late; late_arrival exceptions are raised from door arrival times",
      ["list_exceptions"]
    )
    expect(text).toBe("Fixture Brain chose Exceptions: late arrival exceptions are raised from door arrival times.")
    expect(text).not.toMatch(/\blateness:/)
  })

  it("keeps a rationale that does not restate the question, without a second colon", () => {
    expect(fixture("briefing: morning briefing: today's visits, then open exceptions", ["list_visits", "list_exceptions"])).toBe(
      "Fixture Brain chose Visits and Exceptions: morning briefing, today's visits, then open exceptions."
    )
    expect(fixture("the user confirmed the pending write; replaying it with confirmed true", ["acknowledge_exception"])).toBe(
      "Fixture Brain chose Acknowledge Exception: the user confirmed the pending write, replaying it with confirmed true."
    )
  })

  it("explains a turn with no tool calls in a sentence", () => {
    expect(fixture("no fixture rule matched the utterance", [])).toBe("Fixture Brain: No fixture rule matched the utterance.")
  })

  it("keeps a Bedrock fallback note and a Strands sentence readable", () => {
    expect(fixture("exceptions: asks about problems; open exceptions ranked by severity (Bedrock unavailable: timeout)", ["list_exceptions", "list_exceptions"])).toBe(
      "Fixture Brain chose Exceptions: open exceptions ranked by severity (Bedrock unavailable: timeout)."
    )
    expect(
      describeReasoning({
        brainLabel: "Strands Agent on Bedrock",
        reasoning: "Strands agent on amazon.nova-pro-v1:0 chose get_visit_status",
        toolNames: ["get_visit_status"],
      })
    ).toBe("Strands agent on amazon.nova-pro-v1:0 chose Visit Status.")
  })

  it("never renders a dash", () => {
    const text = fixture("explain_visit: asks to explain a visit; explain_visit returns the three-column evidence", ["explain_visit"])
    expect(text).toBe("Fixture Brain chose Visit Evidence: it returns the three-column evidence.")
    expect(text).not.toMatch(/[–—]/)
  })

  it("joins tool names as a list", () => {
    expect(joinNames(["a"])).toBe("a")
    expect(joinNames(["a", "b"])).toBe("a and b")
    expect(joinNames(["a", "b", "c"])).toBe("a, b, and c")
  })

  it("opens the readable Visual tab first and labels the raw panel as protocol data", () => {
    expect(DEFAULT_DETAIL_TAB).toBe("visual")
    expect(PROTOCOL_NOTE).toMatch(/^Protocol data:/)
    expect(PROTOCOL_NOTE).toMatch(/UTC/)
    expect(PROTOCOL_NOTE).not.toMatch(/[–—]/)
  })
})

describe("trace tab labels", () => {
  it("shows tool calls by their readable titles, never snake_case", () => {
    expect(traceStepLabel("tools/call get_visit_status")).toBe("Tool Call: Visit Status")
    expect(traceStepLabel("tools/call add_visit_note")).toBe("Tool Call: Visit Note")
    expect(traceStepLabel("tools/list")).toBe("Tool List")
    expect(traceStepLabel("initialize")).toBe("Connect To MCP Server")
    expect(traceStepLabel("strands agent")).toBe("Strands Agent")
    expect(traceStepLabel("bedrock failed")).toBe("Bedrock Failed")
  })

  it("reads the isError flag as Error and leaves other details alone", () => {
    expect(traceDetailLabel("isError")).toBe("Error")
    expect(traceDetailLabel("7 tools")).toBe("7 tools")
  })
})
