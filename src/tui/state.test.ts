import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultFormState, loadFormState, normalizeFormState, saveFormState } from "./state";

describe("terminal state", () => {
  test("repairs unsafe saved settings", () => {
    const state = normalizeFormState({
      settings: {
        ...defaultFormState.settings,
        durationMinutes: 999,
        wpm: 2,
        variationPercent: 500,
      },
    });
    expect(state.settings.durationMinutes).toBe(480);
    expect(state.settings.wpm).toBe(20);
    expect(state.settings.variationPercent).toBe(100);
  });

  test("saves atomically and restores the form", async () => {
    const directory = await mkdtemp(join(tmpdir(), "typingbot-state-"));
    const path = join(directory, "nested", "state.json");
    const expected = {
      ...structuredClone(defaultFormState),
      assignment: "explain entropy",
      performance: "{}",
    };
    await saveFormState(expected, path);
    expect(JSON.parse(await readFile(path, "utf8")).assignment).toBe("explain entropy");
    expect(await loadFormState(path)).toEqual(expected);
  });
});
