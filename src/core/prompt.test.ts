import { describe, expect, test } from "bun:test";
import { PERFORMANCE_PROMPT, revisionInstruction } from "./prompt";

describe("performance prompt", () => {
  test("requires recursive transparent drafting", () => {
    expect(PERFORMANCE_PROMPT).toContain("Draft recursively in blocks of one to four sentences");
    expect(PERFORMANCE_PROMPT).toContain("transparent automation");
    expect(PERFORMANCE_PROMPT).toContain("must end with a document byte-for-byte equal to finalText");
  });

  test("scales meaningful edits with revision depth", () => {
    expect(revisionInstruction("light")).toContain("10-20 meaningful actions");
    expect(revisionInstruction("balanced")).toContain("one abandoned paragraph");
    expect(revisionInstruction("deep")).toContain("delete at least one whole paragraph");
    expect(revisionInstruction("deep")).toContain("move or combine material at least twice");
  });
});
