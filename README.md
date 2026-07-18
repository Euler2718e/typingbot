
# TypingBot

Typingbot is a fully-local bot that writes a text, but with a visible planning, drafting and revising. Give chatgpt an assignement, and watch as a bot plans out a text, drafts it, structures it and corrects typos inside your textbox - effectively simulating the writing-process of humans. 

## What it does

- Runs entirely inside an OpenTUI terminal workspace. There is no `.app`, WebView, menu-bar process, account, or required network connection. Once you download this on your computer, it will always be accessible, even without internet connection.
- "Absorbs" your keyboard, letting you type the keys without them affecting the text. Esc pauses (and temporarily let you type again), ctrl+enter resumes and ctrl+x kills the entire thing.
- Runs a screen where you can monitor the process, choose duration, hesitation-percentage, thinking-depth, and much more.
- "Works" through different phases. Lowercase, fast-typed planning with little structure: just jotting down thoughts. Creates drafts in a process where the thoughts evolve into paragraphs, and some sentences are discarded. Structures the paragraphs, changes order of some sentences, deletes part of paragraphs and move them around. At last, it runs a final polishing where it "looks" through the text, corrects typos and adds punctuation etc.
- Varies speed with bursts, hesitation, punctuation pauses, corrected transient typos, and edit pauses.
- Takes long, visible thinking pauses in planning and drafting, and travels back to each correction with slow arrow-key navigation before returning to where it left off.
- Runs for the full requested duration, filling any leftover time with a final read-through rather than stopping as soon as the last edit lands.
- Saves the form locally in `~/.config/typingbot/state.json`.

## Install

TypingBot is built from source. It needs [Bun](https://bun.sh/) and stable [Rust](https://rustup.rs/); Rust compiles the native playback engine.

### 1. Install the prerequisites

```bash
curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal afterwards so both tools are on your `PATH`. On Linux, also install the input libraries:

```bash
sudo apt-get install -y libx11-dev libxtst-dev libxkbcommon-dev libxdo-dev
```

### 2. Build and run

```bash
git clone https://github.com/Euler2718e/typingbot.git
cd typingbot
bun install
bun start
```

The first `bun start` compiles the native engine, which takes a few minutes. Later launches open the terminal interface immediately.

### 3. Grant Accessibility permission

TypingBot cannot type into other applications, or absorb your keystrokes, until the operating system allows it. On macOS the permission belongs to **the terminal application you launched it from** — Terminal, iTerm2, or your editor's integrated terminal — not to a program named TypingBot.

Open **System Settings → Privacy & Security → Accessibility**, enable your terminal application, then quit and reopen it. macOS only applies the change to newly started processes.

Linux desktop input and global shortcuts require an X11 session; Wayland remains a limited platform.

### Updating

```bash
git pull
bun install
bun run engine:build
bun start
```

`bun start` compiles the engine only when the binary is missing, so after any change to the Rust sources run `bun run engine:build` yourself or you will keep running the previous engine.

## Use

1. Run `bun start` from the project directory.
2. Paste the assignment or brief into **Writing request**.
3. Press `Ctrl+G` to copy the complete model prompt.
4. Send it to ChatGPT, Claude, Gemini, or another capable model.
5. Paste only the returned JSON into **Performance JSON**.
6. Configure duration, WPM, countdown, phase allocation, rhythm, variation, hesitation, typo behavior, correction delay, edit pause, thinking depth, correction travel speed, and keyboard absorption.
7. Press `Ctrl+V` to validate without starting, or `Ctrl+Enter` to validate and play.
8. During the countdown, switch to the destination textbox.

The **total time** field sets how long the whole performance lasts (default 60 minutes); the session paces every phase to fill it and stays busy for the full duration.

The terminal may remain behind the destination application. The native engine continues running and reports status back to the terminal. Returning to TypingBot does not alter the document, but leaving the locked destination during playback pauses the session until it is explicitly resumed.

### Controls

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move between fields |
| `Ctrl+Up` / `Ctrl+Down` | Scroll the stacked workspace in narrow terminals |
| `Ctrl+G` | Copy the complete model prompt |
| `Ctrl+V` | Validate the performance |
| `Ctrl+Enter` | Validate and start playback |
| `Ctrl+Space` | Pause or resume from the terminal |
| `Cmd/Ctrl+Alt+Space` | Pause or resume globally |
| `Ctrl+X` | Stop playback (works globally during playback) |
| `Ctrl+C` | Stop the engine and quit cleanly |

While a performance is playing, these controls work from any application:

| Key | Action |
|---|---|
| `Esc` | Pause playback |
| `Ctrl+Enter` | Resume a paused performance |
| `Ctrl+X` | Stop the performance |
| `Cmd/Ctrl+Alt+Space` | Toggle pause and resume |

When keyboard absorption is on, every other key you press is swallowed so it cannot reach the destination document. Turn absorption off in **timing + feel → keyboard** to leave your keyboard live during playback.

## Performance language

The model returns a constrained JSON document rather than raw keyboard instructions. Anchors must be unique at their exact step, actions cannot execute code, and the final simulated document must exactly equal `finalText`.

Read the [performance-format reference](docs/performance-format.md) or open the [complete example](examples/demo.performance.json).

## Development

```bash
bun test               # unit tests
bun run check          # typecheck and cargo check
bun run engine:build   # rebuild the native engine
```

## Privacy and safety

- Prompt construction and performance validation are local.
- TypingBot makes no model or HTTP request.
- Performance scripts cannot access the filesystem, shell, clipboard, or network.
- Physical keystrokes are never recorded or transmitted. When absorption is enabled they are discarded locally so they cannot reach the destination; the engine never inspects or stores them.
- Focus loss pauses external input before the next action.

## License

MIT
