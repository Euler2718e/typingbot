import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { TypingBotApp } from "./app";
import { loadFormState } from "./state";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`typingbot — local terminal writing playback

usage: typingbot

controls:
  ctrl+g       copy the model prompt
  ctrl+v       validate performance json
  ctrl+enter   validate and start playback
  ctrl+space   pause or resume
  ctrl+x       stop playback
  ctrl+c       quit
`);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  process.stdout.write("typingbot 2.0.0\n");
  process.exit(0);
}

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: false,
  targetFps: 20,
  maxFps: 30,
  backgroundColor: "#111311",
  consoleMode: "disabled",
  useMouse: true,
  enableMouseMovement: false,
});

const state = await loadFormState();
createRoot(renderer).render(<TypingBotApp initialState={state} />);
