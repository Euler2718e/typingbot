import { existsSync } from "node:fs";
import { resolve } from "node:path";

const executable = process.platform === "win32" ? "typingbot-engine.exe" : "typingbot-engine";
const engine = resolve(process.cwd(), "src-tauri", "target", "release", executable);

if (!existsSync(engine)) {
  process.stderr.write("Building the local TypingBot playback engine...\n");
  const build = Bun.spawnSync([
    "cargo",
    "build",
    "--release",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--bin",
    "typingbot-engine",
  ], { stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) process.exit(build.exitCode);
}

process.env.TYPINGBOT_ENGINE = engine;
await import("./index");
