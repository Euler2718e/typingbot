/** @jsxImportSource @opentui/react */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { TypingBotApp } from "./app";
import { defaultFormState } from "./state";

describe("terminal interface", () => {
  test("shows the complete workspace at 120x35", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <TypingBotApp
          initialState={structuredClone(defaultFormState)}
          connectEngine={false}
          persistState={false}
        />,
        { width: 120, height: 35, kittyKeyboard: true },
      );
    });
    await act(async () => { await setup.renderOnce(); });
    let frame = setup.captureCharFrame();
    expect(frame).toContain("TypingBot");
    expect(frame).toContain("Local writing playback");
    expect(frame).toContain("Engine ready");
    expect(frame).toContain("Style required");
    expect(frame).toContain("Workflow");
    expect(frame).toContain("Writing style");
    expect(frame).toContain("Choose a number before creating or playing");
    expect(frame).toContain("Writing request");
    expect(frame).toContain("Revision depth");
    expect(frame).toContain("Performance JSON");
    expect(frame).toContain("Session");
    expect(frame).toContain("Timing");
    expect(frame).toContain("Process");
    expect(frame).toContain("Ctrl+Enter Play");

    const settingsFrames = [frame];
    // The inspector scrolls independently so every preserved control remains reachable.
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        setup.mockInput.pressArrow("down", { ctrl: true });
        await setup.flush();
      });
      settingsFrames.push(setup.captureCharFrame());
    }
    frame = settingsFrames.join("\n");
    for (const label of [
      "Total time",
      "Base speed",
      "Focus window",
      "Planning",
      "Drafting",
      "Polishing",
      "Cadence profile",
      "Repair mistakes",
      "Speed variation",
      "Hesitation",
      "Corrected typos",
      "Correction delay",
      "Pause before edits",
      "Thinking depth",
      "Correction travel",
      "Keystroke handling",
      "Command shortcuts stay live",
    ]) {
      expect(frame).toContain(label);
    }
    await act(async () => { setup.renderer.destroy(); });
  });

  test("keeps the compose surface usable at 80x24", async () => {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <TypingBotApp
          initialState={structuredClone(defaultFormState)}
          connectEngine={false}
          persistState={false}
        />,
        { width: 80, height: 24 },
      );
    });
    await act(async () => { await setup.renderOnce(); });
    let frame = setup.captureCharFrame();
    expect(frame).toContain("TypingBot");
    expect(frame).toContain("Workflow");
    expect(frame).toContain("Writing request");
    expect(frame).toContain("Ctrl+G");
    expect(frame).toContain("Ctrl+Space Pause");
    expect(frame).toContain("Ctrl+X Stop");
    expect(frame).toContain("Ctrl+C Quit");
    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        setup.mockInput.pressArrow("down", { ctrl: true });
        await setup.flush();
      });
    }
    frame = setup.captureCharFrame();
    expect(frame).toContain("Performance JSON");
    await act(async () => { setup.renderer.destroy(); });
  });

  test("shows the selected process identity in the monitor", async () => {
    const initialState = structuredClone(defaultFormState);
    initialState.promptPreferences.writingStyle = 18;
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <TypingBotApp initialState={initialState} connectEngine={false} persistState={false} />,
        { width: 120, height: 35 },
      );
    });
    await act(async () => { await setup.renderOnce(); });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Style 18");
    expect(frame).toContain("the systems thinker");
    expect(frame).toContain("trace feedback loops, incentives, and second-order effects");
    await act(async () => { setup.renderer.destroy(); });
  });

});
