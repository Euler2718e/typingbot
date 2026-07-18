import { describe, expect, test } from "bun:test";
import { buildPerformancePrompt, PERFORMANCE_PROMPT, revisionInstruction } from "./prompt";
import { WRITING_STYLES } from "./styles";
import type { SessionSettings } from "./types";

const settings: SessionSettings = {
  durationMinutes: 45,
  wpm: 92,
  countdownSeconds: 8,
  planningPercent: 20,
  draftingPercent: 55,
  polishingPercent: 25,
  correctedTypos: true,
  rhythmProfile: "reflective",
  variationPercent: 71,
  hesitationPercent: 64,
  typosPerThousand: 9,
  correctionDelayMs: 210,
  editPauseMs: 600,
  absorbKeystrokes: false,
  thinkingIntensity: 82,
  correctionNavMs: 31,
};

describe("performance prompt", () => {
  test("requires structured transparent drafting", () => {
    expect(PERFORMANCE_PROMPT).toContain("Draft according to the selected style");
    expect(PERFORMANCE_PROMPT).toContain("Planning must follow the selected style");
    expect(PERFORMANCE_PROMPT).toContain("transparent automation");
    expect(PERFORMANCE_PROMPT).toContain("must end with a document byte-for-byte equal to finalText");
  });

  test("scales meaningful edits with revision depth", () => {
    expect(revisionInstruction("light")).toContain("10-20 meaningful actions");
    expect(revisionInstruction("balanced")).toContain("one abandoned paragraph");
    expect(revisionInstruction("deep")).toContain("delete at least one whole paragraph");
    expect(revisionInstruction("deep")).toContain("move or combine material at least twice");
  });

  test("offers thirty distinct process identities", () => {
    expect(WRITING_STYLES).toHaveLength(30);
    expect(new Set(WRITING_STYLES.map((style) => style.id)).size).toBe(30);
    expect(new Set(WRITING_STYLES.map((style) => style.name)).size).toBe(30);
    expect(new Set(WRITING_STYLES.map((style) => [style.planning, style.drafting, style.revising, style.voice].join("|"))).size).toBe(30);
  });

  test("includes the selected style and every session setting", () => {
    const prompt = buildPerformancePrompt(
      "Explain why leaves change color.",
      { revisionDensity: "balanced", writingStyle: 18 },
      settings,
    );
    expect(prompt).toContain("Style 18: the systems thinker");
    expect(prompt).toContain("Map actors, flows, constraints");
    expect(prompt).toContain("Target runtime: 45 minutes");
    expect(prompt).toContain("Base typing speed: 92 WPM");
    expect(prompt).toContain("Countdown before capture: 8 seconds");
    expect(prompt).toContain("planning 20%, drafting 55%, polishing 25%");
    expect(prompt).toContain("Rhythm profile: reflective");
    expect(prompt).toContain("Speed variation: 71%");
    expect(prompt).toContain("Hesitation: 64%");
    expect(prompt).toContain("Thinking depth: 82%");
    expect(prompt).toContain("9 transient corrected typos");
    expect(prompt).toContain("Correction delay: 210 ms");
    expect(prompt).toContain("pause before edits: 600 ms");
    expect(prompt).toContain("correction travel: 31 ms");
    expect(prompt).toContain("Keyboard absorption: off");
    expect(prompt).toContain("Explain why leaves change color.");
  });

  test("requires a style before building a prompt", () => {
    expect(() => buildPerformancePrompt("request", { revisionDensity: "deep", writingStyle: null }, settings))
      .toThrow("Choose a writing style from 1 to 30");
  });
});
