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
    expect(frame).toContain("typingbot / terminal writing playback");
    expect(frame).toContain("writing style (required)");
    expect(frame).toContain("choose a number before prompt + play");
    expect(frame).toContain("writing request");
    expect(frame).toContain("performance json");
    expect(frame).toContain("process allocation");
    expect(frame).toContain("ctrl+enter play");
    // The dense "timing + feel" column scrolls; reveal the lower controls.
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        setup.mockInput.pressArrow("down", { ctrl: true });
        await setup.flush();
      });
    }
    frame = setup.captureCharFrame();
    expect(frame).toContain("thinking depth");
    expect(frame).toContain("correction travel");
    expect(frame).toContain("absorb");
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
    expect(frame).toContain("compose");
    expect(frame).toContain("writing request");
    expect(frame).toContain("ctrl+g");
    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        setup.mockInput.pressArrow("down", { ctrl: true });
        await setup.flush();
      });
    }
    frame = setup.captureCharFrame();
    expect(frame).toContain("performance json");
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
    expect(frame).toContain("style 18");
    expect(frame).toContain("the systems thinker");
    expect(frame).toContain("trace feedback loops, incentives, and second-order effects");
    await act(async () => { setup.renderer.destroy(); });
  });

});
