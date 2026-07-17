import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import "./styles.css";
import { PERFORMANCE_PROMPT } from "./core/prompt";
import type { PerformanceScript, SessionSettings, SessionStatus, ValidationResult } from "./core/types";
import { parsePerformanceScript, validatePerformanceScript } from "./core/validate";

const defaultSettings: SessionSettings = {
  durationMinutes: 60,
  wpm: 85,
  countdownSeconds: 7,
  planningPercent: 15,
  draftingPercent: 60,
  polishingPercent: 25,
  correctedTypos: true,
};

let script: PerformanceScript | null = null;
let status: SessionStatus = {
  state: "idle",
  phase: null,
  actionIndex: 0,
  actionCount: 0,
  elapsedMs: 0,
  targetDurationMs: 0,
  message: "Paste a performance to begin",
  targetApplication: null,
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand-block">
        <span class="wordmark">TYPINGBOT</span>
        <span class="subtitle">local writing playback</span>
      </div>
      <div class="local-badge">offline after paste</div>
    </header>

    <section class="intro" aria-labelledby="intro-title">
      <p class="kicker">Plan. Draft. Revise.</p>
      <h1 id="intro-title">Turn a final text into a visible writing process.</h1>
      <p>Generate a structured performance with your preferred model, paste it here, then play it locally into any focused text field.</p>
    </section>

    <div class="workspace">
      <section class="panel prompt-panel" aria-labelledby="prompt-heading">
        <div class="panel-heading">
          <h2 id="prompt-heading">Prepare the model prompt</h2>
          <button class="button secondary" id="copy-prompt" type="button">Copy prompt</button>
        </div>
        <label for="assignment">Writing request</label>
        <textarea id="assignment" rows="5" placeholder="Paste the assignment, brief, or writing request here."></textarea>
        <p class="helper">The copied prompt includes the local action language and your request. No text is sent by TypingBot.</p>
      </section>

      <section class="panel performance-panel" aria-labelledby="performance-heading">
        <div class="panel-heading">
          <h2 id="performance-heading">Load the performance</h2>
          <span class="validation-pill neutral" id="validation-pill">not checked</span>
        </div>
        <label for="performance">Model output</label>
        <textarea id="performance" class="code-input" rows="10" spellcheck="false" placeholder='Paste the JSON object here. It should begin with { "version": "1.0" ... }'></textarea>
        <div id="validation-detail" class="validation-detail" aria-live="polite">TypingBot validates every anchor and verifies the exact final document before playback.</div>
      </section>

      <section class="panel settings-panel" aria-labelledby="settings-heading">
        <div class="panel-heading">
          <h2 id="settings-heading">Set the session</h2>
        </div>
        <div class="settings-grid">
          <label class="field" for="duration">
            <span>Duration</span>
            <span class="number-wrap"><input id="duration" type="number" min="1" max="480" value="60"><b>min</b></span>
          </label>
          <label class="field" for="wpm">
            <span>Average speed</span>
            <span class="number-wrap"><input id="wpm" type="number" min="20" max="220" value="85"><b>wpm</b></span>
          </label>
          <label class="field" for="countdown">
            <span>Focus countdown</span>
            <span class="number-wrap"><input id="countdown" type="number" min="3" max="30" value="7"><b>sec</b></span>
          </label>
          <label class="check-field" for="typos">
            <input id="typos" type="checkbox" checked>
            <span><strong>Corrected typos</strong><small>All mistakes are repaired before completion.</small></span>
          </label>
        </div>
        <div class="phase-row" aria-label="Phase allocation">
          <label>Planning <span><input id="planning" type="number" min="0" max="100" value="15">%</span></label>
          <label>Drafting <span><input id="drafting" type="number" min="0" max="100" value="60">%</span></label>
          <label>Polishing <span><input id="polishing" type="number" min="0" max="100" value="25">%</span></label>
        </div>
      </section>
    </div>

    <section class="runbar" aria-label="Session controls">
      <div class="run-status">
        <span class="state-mark" id="state-mark"></span>
        <div>
          <strong id="state-title">Ready for a performance</strong>
          <span id="state-message">Global safety shortcut: Cmd/Ctrl + Alt + Space</span>
        </div>
      </div>
      <div class="run-actions">
        <button class="button secondary" id="pause" type="button" disabled>Pause</button>
        <button class="button danger" id="stop" type="button" disabled>Stop</button>
        <button class="button primary" id="play" type="button" disabled>Validate and play</button>
      </div>
      <div class="progress-track" aria-hidden="true"><span id="progress"></span></div>
    </section>

    <footer>
      <span>Transparent automation for demos, accessibility, and rehearsal.</span>
      <span>Physical typing is never intercepted.</span>
    </footer>
  </main>
`;

const elements = {
  assignment: get<HTMLTextAreaElement>("assignment"),
  performance: get<HTMLTextAreaElement>("performance"),
  copyPrompt: get<HTMLButtonElement>("copy-prompt"),
  validationPill: get<HTMLSpanElement>("validation-pill"),
  validationDetail: get<HTMLDivElement>("validation-detail"),
  duration: get<HTMLInputElement>("duration"),
  wpm: get<HTMLInputElement>("wpm"),
  countdown: get<HTMLInputElement>("countdown"),
  typos: get<HTMLInputElement>("typos"),
  planning: get<HTMLInputElement>("planning"),
  drafting: get<HTMLInputElement>("drafting"),
  polishing: get<HTMLInputElement>("polishing"),
  play: get<HTMLButtonElement>("play"),
  pause: get<HTMLButtonElement>("pause"),
  stop: get<HTMLButtonElement>("stop"),
  stateMark: get<HTMLSpanElement>("state-mark"),
  stateTitle: get<HTMLElement>("state-title"),
  stateMessage: get<HTMLElement>("state-message"),
  progress: get<HTMLSpanElement>("progress"),
};

restoreForm();

elements.assignment.addEventListener("input", persistForm);
elements.performance.addEventListener("input", () => {
  persistForm();
  script = null;
  elements.play.disabled = !elements.performance.value.trim();
  setValidation("neutral", "not checked", "TypingBot validates every anchor and verifies the exact final document before playback.");
});
for (const input of [elements.duration, elements.wpm, elements.countdown, elements.typos, elements.planning, elements.drafting, elements.polishing]) {
  input.addEventListener("change", persistForm);
}

elements.copyPrompt.addEventListener("click", async () => {
  const request = elements.assignment.value.trim();
  const complete = `${PERFORMANCE_PROMPT}\n\nUSER WRITING REQUEST:\n${request || "[Paste your writing request here before sending.]"}`;
  await navigator.clipboard.writeText(complete);
  elements.copyPrompt.textContent = "Copied";
  window.setTimeout(() => { elements.copyPrompt.textContent = "Copy prompt"; }, 1600);
});

elements.play.addEventListener("click", async () => {
  try {
    const candidate = parsePerformanceScript(elements.performance.value);
    const settings = readSettings();
    const result = validatePerformanceScript(candidate, settings);
    showValidation(result);
    if (!result.valid) return;
    await invoke("validate_performance", { script: candidate });
    script = candidate;
    await invoke("start_session", { script, settings });
    setControls("countdown");
    await getCurrentWindow().hide();
  } catch (error) {
    setValidation("error", "needs attention", errorMessage(error));
  }
});

elements.pause.addEventListener("click", togglePause);
elements.stop.addEventListener("click", async () => {
  await invoke("stop_session");
  status = { ...status, state: "stopped", message: "Session stopped by user" };
  renderStatus();
});

void setupRuntime();

async function setupRuntime(): Promise<void> {
  try {
    await listen<SessionStatus>("session-status", ({ payload }) => {
      status = payload;
      renderStatus();
    });
    await register("CommandOrControl+Alt+Space", async (event) => {
      if (event.state !== "Pressed") return;
      await togglePause();
    });
  } catch {
    elements.stateMessage.textContent = "Browser preview mode. Desktop controls activate inside the installed app.";
  }
}

async function togglePause(): Promise<void> {
  if (status.state === "running" || status.state === "countdown") {
    await invoke("pause_session");
    status = { ...status, state: "paused", message: "Paused with the safety control" };
  } else if (status.state === "paused") {
    await invoke("resume_session");
    status = { ...status, state: "running", message: "Resuming in the locked destination" };
  }
  renderStatus();
}

function showValidation(result: ValidationResult): void {
  if (result.valid) {
    const warning = result.warnings[0] ? ` ${result.warnings[0]}` : "";
    setValidation(
      "valid",
      "verified",
      `${result.stats.actions} actions, ${result.stats.typedCharacters.toLocaleString()} typed characters, exact final text confirmed.${warning}`,
    );
    return;
  }
  setValidation("error", "needs attention", result.errors.slice(0, 3).join(" "));
}

function setValidation(kind: "neutral" | "valid" | "error", label: string, detail: string): void {
  elements.validationPill.className = `validation-pill ${kind}`;
  elements.validationPill.textContent = label;
  elements.validationDetail.className = `validation-detail ${kind}`;
  elements.validationDetail.textContent = detail;
}

function readSettings(): SessionSettings {
  return {
    durationMinutes: clamp(Number(elements.duration.value), 1, 480),
    wpm: clamp(Number(elements.wpm.value), 20, 220),
    countdownSeconds: clamp(Number(elements.countdown.value), 3, 30),
    planningPercent: clamp(Number(elements.planning.value), 0, 100),
    draftingPercent: clamp(Number(elements.drafting.value), 0, 100),
    polishingPercent: clamp(Number(elements.polishing.value), 0, 100),
    correctedTypos: elements.typos.checked,
  };
}

function renderStatus(): void {
  setControls(status.state);
  const active = ["countdown", "running", "paused"].includes(status.state);
  elements.stateTitle.textContent = status.phase ? `${capitalize(status.state)}: ${status.phase}` : capitalize(status.state);
  elements.stateMessage.textContent = status.targetApplication
    ? `${status.message} Target: ${status.targetApplication}`
    : status.message;
  elements.stateMark.className = `state-mark ${status.state}`;
  const progress = status.targetDurationMs > 0 ? Math.min(100, status.elapsedMs / status.targetDurationMs * 100) : 0;
  elements.progress.style.width = `${progress}%`;
  if (status.state === "completed") elements.progress.style.width = "100%";
  elements.pause.textContent = status.state === "paused" ? "Resume" : "Pause";
  elements.pause.disabled = !active;
  elements.stop.disabled = !active;
}

function setControls(state: SessionStatus["state"]): void {
  const active = ["countdown", "running", "paused"].includes(state);
  elements.play.disabled = active || !elements.performance.value.trim();
  elements.pause.disabled = !active;
  elements.stop.disabled = !active;
}

function persistForm(): void {
  localStorage.setItem("typingbot.form", JSON.stringify({
    assignment: elements.assignment.value,
    performance: elements.performance.value,
    settings: readSettings(),
  }));
}

function restoreForm(): void {
  try {
    const stored = JSON.parse(localStorage.getItem("typingbot.form") ?? "null") as {
      assignment?: string;
      performance?: string;
      settings?: Partial<SessionSettings>;
    } | null;
    if (!stored) return;
    elements.assignment.value = stored.assignment ?? "";
    elements.performance.value = stored.performance ?? "";
    const settings = { ...defaultSettings, ...stored.settings };
    elements.duration.value = String(settings.durationMinutes);
    elements.wpm.value = String(settings.wpm);
    elements.countdown.value = String(settings.countdownSeconds);
    elements.planning.value = String(settings.planningPercent);
    elements.drafting.value = String(settings.draftingPercent);
    elements.polishing.value = String(settings.polishingPercent);
    elements.typos.checked = settings.correctedTypos;
    elements.play.disabled = !elements.performance.value.trim();
  } catch {
    localStorage.removeItem("typingbot.form");
  }
}

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
