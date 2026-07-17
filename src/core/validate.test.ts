import { describe, expect, test } from "bun:test";
import { validatePerformanceScript } from "./validate";
import type { PerformanceScript } from "./types";

const validScript: PerformanceScript = {
  version: "1.0",
  title: "small example",
  finalText: "A clearer opening.\n\nThe final paragraph.",
  actions: [
    { op: "append", phase: "planning", text: "opening idea\nmaybe shorter", effort: 2 },
    { op: "clear", phase: "drafting", effort: 1 },
    { op: "append", phase: "drafting", text: "A rough opening.\n\nThe final paragraph.", effort: 3 },
    { op: "replace", phase: "polishing", find: "rough", text: "clearer", effort: 2 },
    { op: "pause", phase: "polishing", effort: 1 },
  ],
};

describe("validatePerformanceScript", () => {
  test("accepts an exact deterministic performance", () => {
    const result = validatePerformanceScript(validScript);
    expect(result.valid).toBe(true);
    expect(result.stats.finalCharacters).toBe(validScript.finalText.length);
  });

  test("rejects ambiguous anchors", () => {
    const script = structuredClone(validScript);
    script.actions[3] = { op: "replace", phase: "polishing", find: "a", text: "b" };
    expect(validatePerformanceScript(script).errors.join(" ")).toContain("match exactly once");
  });

  test("rejects a performance that does not reach finalText", () => {
    const script = structuredClone(validScript);
    script.finalText += " missing";
    expect(validatePerformanceScript(script).errors).toContain("the simulated document does not exactly equal finalText");
  });

  test("rejects phase regression", () => {
    const script = structuredClone(validScript);
    script.actions.push({ op: "pause", phase: "drafting" });
    expect(validatePerformanceScript(script).errors.join(" ")).toContain("moves backwards");
  });
});
