# TypingBot

TypingBot is a fully local bot that writes text through a visible process of planning, drafting, restructuring, and polishing. Give an LLM a writing assignment, paste its validated performance into TypingBot, and watch the document develop inside your chosen textbox instead of appearing all at once.

It is built for transparent writing demonstrations, accessibility workflows, and screen recordings. It does not claim that automated text was written by a person.

<p align="center">
  <a href="assets/typingbot-demo.mp4">
    <img src="assets/typingbot-banner.png" alt="Watch the TypingBot demo" width="800">
  </a>
</p>

<p align="center"><strong>▶ Click to watch the 35-second demo</strong> · 1080p · no audio</p>

## What it does

- Runs entirely inside a focused OpenTUI terminal workspace. There is no account, cloud database, WebView, or required runtime network connection.
- Offers 30 distinct writing styles. Each style has its own planning method, drafting pattern, revision behavior, and final voice, and you must choose one before generating or playing a performance.
- Builds a detailed model prompt from your selected style, writing request, revision depth, duration, phase allocation, rhythm, hesitation, typing speed, correction behavior, and other session settings.
- Works through visible phases. Planning begins as rough notes and abandoned directions. Drafting grows in blocks, moves ideas around, and replaces weak passages. Polishing corrects the final structure, wording, grammar, and punctuation.
- Varies typing speed through bursts, hesitation, punctuation pauses, corrected transient typos, and deliberate pauses before edits.
- Travels back to corrections with visible arrow-key navigation, then returns to the end of the document.
- Runs for the full requested duration, using any remaining time for a final read-through instead of ending immediately after the last edit.
- Can absorb ordinary physical keystrokes during playback so they do not alter the destination. Normal Command shortcuts on macOS and Control shortcuts on Windows/Linux remain available, and absorption can be turned off.
- Saves the terminal form locally in `~/.config/typingbot/state.json`.

## How it works

1. Choose a writing style from 1 to 30.
2. Add the writing request and configure the session.
3. Press `Ctrl+G` and send the copied prompt to ChatGPT, Claude, Gemini, or another capable model.
4. Paste the returned JSON into TypingBot, validate it, and start playback.

The model never controls your computer. It only returns a constrained JSON performance. TypingBot simulates every action locally and refuses to start unless the actions produce `finalText` exactly.

## Install from source

Building from source is the primary installation path. It is transparent, works across platforms, and avoids the signing warnings attached to unnotarized public binaries.

TypingBot needs [Bun](https://bun.sh/) and stable [Rust](https://rustup.rs/). Install both by pasting these commands into your terminal:

```bash
curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Close and reopen the terminal once so both tools are available, then paste:

```bash
git clone https://github.com/Euler2718e/typingbot.git
cd typingbot
bun install
bun start
```

The first `bun start` compiles the native playback engine and may take a few minutes. Later launches open the terminal interface immediately.

### Linux prerequisites

Linux desktop input requires an X11 session and these development libraries:

```bash
sudo apt-get update
sudo apt-get install -y libdbus-1-dev pkg-config libx11-dev libxtst-dev libxkbcommon-dev libxdo-dev
```

Wayland intentionally restricts synthetic input and global shortcuts, so full playback is not promised there.

### macOS Accessibility permission

TypingBot cannot type into other applications or absorb keystrokes until macOS allows your terminal to control the computer.

Open **System Settings → Privacy & Security → Accessibility**, enable the terminal application you use, then quit and reopen it. The permission belongs to Terminal, iTerm2, or your editor's integrated terminal, not to a graphical TypingBot application.

### Updating

```bash
git pull
bun install
bun run engine:build
bun start
```

`bun start` compiles the engine only when its binary is missing. After pulling changes to Rust files, run `bun run engine:build` so playback uses the new engine.

## Use

1. Run `bun start` from the project directory.
2. Enter a number from 1 to 30 in the required **Writing style** field.
3. Paste the assignment or brief into **Writing request**.
4. Configure duration, WPM, countdown, phase allocation, revision depth, rhythm, variation, hesitation, typo behavior, correction delay, edit pause, thinking depth, correction travel speed, and keyboard absorption.
5. Press `Ctrl+G` to copy the complete style-aware model prompt.
6. Send that prompt to an LLM and paste only its returned JSON into **Performance JSON**.
7. Press `Ctrl+V` to validate without starting, or `Ctrl+Enter` to validate and play.
8. During the countdown, focus the destination textbox.

The native engine continues running when the terminal is behind another application. If focus leaves the captured destination application, playback pauses until you return and explicitly resume it.

### Terminal controls

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move between fields |
| `Ctrl+Up` / `Ctrl+Down` | Scroll the stacked workspace in narrow terminals |
| `Ctrl+G` | Copy the complete model prompt |
| `Ctrl+V` | Validate the performance |
| `Ctrl+Enter` | Validate and start playback |
| `Ctrl+Space` | Pause or resume from the terminal |
| `Ctrl+X` | Stop playback |
| `Ctrl+C` | Stop the engine and quit cleanly |

### Global playback controls

These controls work from the destination application:

| Key | Action |
|---|---|
| `Esc` | Pause playback and return the ordinary keyboard |
| `Ctrl+Enter` | Resume a paused performance |
| `Ctrl+X` | Stop the performance |
| `Cmd+Alt+Space` on macOS | Toggle pause and resume |
| `Ctrl+Alt+Space` on Windows/Linux | Toggle pause and resume |

When keyboard absorption is enabled, ordinary typing is discarded locally. Command shortcuts such as `Cmd+C`, `Cmd+V`, and `Cmd+Z` on macOS, or their Control equivalents on Windows/Linux, still pass through. Set **keyboard → off** if you want every ordinary key to remain live during playback.

## Performance language

The model returns semantic editing actions rather than raw keyboard instructions. Anchors must be unique at the exact step where they are used, actions cannot execute code, and the final simulated document must exactly equal `finalText`.

Read the [performance-format reference](docs/performance-format.md) or open the [complete example](examples/demo.performance.json).

## Development

```bash
bun test
bun run check
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Privacy and safety

- Prompt construction, state storage, performance validation, and playback are local.
- TypingBot makes no model or HTTP request.
- Performance scripts cannot access the filesystem, shell, clipboard, or network.
- Physical keystrokes are never recorded or transmitted. Absorbed keys are discarded locally.
- Focus loss pauses external input before the next action.
- The performance is transparent automation, not evidence of human authorship.

Platform signing limitations for optional release binaries are documented in [BLOCKERS.md](BLOCKERS.md).

## License

MIT
