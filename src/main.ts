import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import gsap from "gsap";
import "./styles.css";
import { PERFORMANCE_PROMPT } from "./core/prompt";
import type {
  PerformanceScript,
  PromptPreferences,
  SessionSettings,
  SessionStatus,
  ValidationResult,
} from "./core/types";
import { parsePerformanceScript, validatePerformanceScript } from "./core/validate";

const defaultSettings: SessionSettings = {
  durationMinutes: 60,
  wpm: 85,
  countdownSeconds: 7,
  planningPercent: 15,
  draftingPercent: 60,
  polishingPercent: 25,
  correctedTypos: true,
  rhythmProfile: "natural",
  variationPercent: 62,
  hesitationPercent: 54,
  typosPerThousand: 12,
  correctionDelayMs: 180,
  editPauseMs: 520,
};

const defaultPromptPreferences: PromptPreferences = {
  revisionDensity: "deep",
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
  <main class="popover-shell">
    <div class="popover-caret" aria-hidden="true"></div>

    <header class="utility-header">
      <div class="brand-lockup">
        <span class="brand-signal" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <strong>typingbot</strong>
          <span>local writing playback</span>
        </div>
      </div>
      <div class="header-state">
        <span class="status-dot idle" id="status-dot"></span>
        <span id="header-state">ready</span>
        <button class="quiet-button" id="close-panel" type="button" aria-label="Close panel">close</button>
      </div>
    </header>

    <section class="live-strip" aria-live="polite">
      <div class="live-copy">
        <strong id="state-title">Ready for a performance</strong>
        <span id="state-message">Offline. Nothing leaves this Mac.</span>
      </div>
      <span class="live-time" id="live-time">00:00</span>
      <div class="progress-rail" aria-hidden="true"><span id="progress"></span></div>
    </section>

    <nav class="mode-switch" aria-label="Configuration sections">
      <button class="active" data-view="compose" type="button">compose</button>
      <button data-view="timing" type="button">timing</button>
      <button data-view="feel" type="button">feel</button>
    </nav>

    <div class="view-stack">
      <section class="view active" data-panel="compose" aria-label="Compose">
        <article class="surface source-surface">
          <div class="surface-heading">
            <div>
              <h1>Build the process</h1>
              <p>Give your model the brief and the local edit language.</p>
            </div>
            <button class="button paper" id="copy-prompt" type="button">copy prompt</button>
          </div>
          <label for="assignment">Writing request</label>
          <textarea id="assignment" rows="3" placeholder="Paste the assignment, brief, or writing request."></textarea>
          <div class="compact-row">
            <label for="revision-density">Revision depth</label>
            <select id="revision-density">
              <option value="light">light</option>
              <option value="balanced">balanced</option>
              <option value="deep" selected>deep</option>
            </select>
          </div>
        </article>

        <article class="surface performance-surface">
          <div class="surface-heading compact">
            <div>
              <h2>Performance JSON</h2>
              <p id="performance-summary">waiting for model output</p>
            </div>
            <span class="validation-state neutral" id="validation-pill">unchecked</span>
          </div>
          <textarea id="performance" class="code-input" rows="8" spellcheck="false" placeholder='{ "version": "1.0", "finalText": "..." }'></textarea>
          <p id="validation-detail" class="validation-detail">Every edit and the exact final text are verified before playback.</p>
        </article>
      </section>

      <section class="view" data-panel="timing" aria-label="Timing">
        <div class="settings-bento">
          <label class="metric-card" for="duration">
            <span>total time</span>
            <span class="metric-input"><input id="duration" type="number" min="1" max="480" value="60"><b>min</b></span>
          </label>
          <label class="metric-card" for="wpm">
            <span>base speed</span>
            <span class="metric-input"><input id="wpm" type="number" min="20" max="220" value="85"><b>wpm</b></span>
          </label>
          <label class="metric-card" for="countdown">
            <span>focus window</span>
            <span class="metric-input"><input id="countdown" type="number" min="3" max="30" value="7"><b>sec</b></span>
          </label>
          <div class="metric-card duration-readout">
            <span>estimated finish</span>
            <strong id="finish-time">in 1h 00m</strong>
          </div>
        </div>

        <article class="surface phase-surface">
          <div class="surface-heading compact">
            <div>
              <h2>Process allocation</h2>
              <p>Time is distributed by action effort inside each phase.</p>
            </div>
            <span class="phase-total" id="phase-total">100%</span>
          </div>
          <div class="phase-stack">
            <label for="planning"><span><i class="phase-swatch planning"></i>planning</span><span><input id="planning" type="number" min="0" max="100" value="15">%</span></label>
            <label for="drafting"><span><i class="phase-swatch drafting"></i>drafting</span><span><input id="drafting" type="number" min="0" max="100" value="60">%</span></label>
            <label for="polishing"><span><i class="phase-swatch polishing"></i>polishing</span><span><input id="polishing" type="number" min="0" max="100" value="25">%</span></label>
          </div>
          <div class="phase-bar" aria-hidden="true"><i id="planning-bar"></i><i id="drafting-bar"></i><i id="polishing-bar"></i></div>
        </article>
      </section>

      <section class="view" data-panel="feel" aria-label="Feel">
        <article class="surface feel-intro">
          <div>
            <h1>Shape the rhythm</h1>
            <p>These controls change actual keystroke timing, corrected mistakes, hesitation, and edit pacing.</p>
          </div>
          <label class="toggle-field" for="typos"><input id="typos" type="checkbox" checked><span></span><b>correct mistakes</b></label>
        </article>

        <article class="surface control-surface">
          <div class="compact-row profile-row">
            <label for="rhythm-profile">Rhythm profile</label>
            <select id="rhythm-profile">
              <option value="steady">steady</option>
              <option value="natural" selected>natural</option>
              <option value="reflective">reflective</option>
            </select>
          </div>
          <label class="range-field" for="variation"><span><b>Speed variation</b><output id="variation-output">62%</output></span><input id="variation" type="range" min="0" max="100" value="62"></label>
          <label class="range-field" for="hesitation"><span><b>Hesitation</b><output id="hesitation-output">54%</output></span><input id="hesitation" type="range" min="0" max="100" value="54"></label>
          <label class="range-field" for="typo-frequency"><span><b>Corrected typos</b><output id="typo-frequency-output">12 / 1k</output></span><input id="typo-frequency" type="range" min="0" max="50" value="12"></label>
          <label class="range-field" for="correction-delay"><span><b>Correction delay</b><output id="correction-delay-output">180 ms</output></span><input id="correction-delay" type="range" min="40" max="1200" step="10" value="180"></label>
          <label class="range-field" for="edit-pause"><span><b>Pause before edits</b><output id="edit-pause-output">520 ms</output></span><input id="edit-pause" type="range" min="0" max="3000" step="20" value="520"></label>
        </article>
      </section>
    </div>

    <footer class="action-dock">
      <div class="safety-copy">
        <span>global control</span>
        <kbd>cmd/ctrl + alt + space</kbd>
      </div>
      <div class="action-buttons">
        <button class="button ghost" id="pause" type="button" disabled>pause</button>
        <button class="button ghost danger" id="stop" type="button" disabled>stop</button>
        <button class="button primary" id="play" type="button" disabled>validate + play</button>
      </div>
    </footer>
  </main>
`;

const elements = {
  assignment: get<HTMLTextAreaElement>("assignment"),
  performance: get<HTMLTextAreaElement>("performance"),
  copyPrompt: get<HTMLButtonElement>("copy-prompt"),
  closePanel: get<HTMLButtonElement>("close-panel"),
  revisionDensity: get<HTMLSelectElement>("revision-density"),
  validationPill: get<HTMLSpanElement>("validation-pill"),
  validationDetail: get<HTMLParagraphElement>("validation-detail"),
  performanceSummary: get<HTMLParagraphElement>("performance-summary"),
  duration: get<HTMLInputElement>("duration"),
  wpm: get<HTMLInputElement>("wpm"),
  countdown: get<HTMLInputElement>("countdown"),
  typos: get<HTMLInputElement>("typos"),
  planning: get<HTMLInputElement>("planning"),
  drafting: get<HTMLInputElement>("drafting"),
  polishing: get<HTMLInputElement>("polishing"),
  rhythmProfile: get<HTMLSelectElement>("rhythm-profile"),
  variation: get<HTMLInputElement>("variation"),
  hesitation: get<HTMLInputElement>("hesitation"),
  typoFrequency: get<HTMLInputElement>("typo-frequency"),
  correctionDelay: get<HTMLInputElement>("correction-delay"),
  editPause: get<HTMLInputElement>("edit-pause"),
  finishTime: get<HTMLElement>("finish-time"),
  phaseTotal: get<HTMLElement>("phase-total"),
  planningBar: get<HTMLElement>("planning-bar"),
  draftingBar: get<HTMLElement>("drafting-bar"),
  polishingBar: get<HTMLElement>("polishing-bar"),
  play: get<HTMLButtonElement>("play"),
  pause: get<HTMLButtonElement>("pause"),
  stop: get<HTMLButtonElement>("stop"),
  statusDot: get<HTMLSpanElement>("status-dot"),
  headerState: get<HTMLElement>("header-state"),
  stateTitle: get<HTMLElement>("state-title"),
  stateMessage: get<HTMLElement>("state-message"),
  liveTime: get<HTMLElement>("live-time"),
  progress: get<HTMLElement>("progress"),
};

restoreForm();
updateReadouts();
setupTabs();
animateEntrance();

elements.assignment.addEventListener("input", persistForm);
elements.performance.addEventListener("input", () => {
  persistForm();
  script = null;
  elements.play.disabled = !elements.performance.value.trim();
  elements.performanceSummary.textContent = elements.performance.value.trim()
    ? `${elements.performance.value.length.toLocaleString()} characters loaded`
    : "waiting for model output";
  setValidation("neutral", "unchecked", "Every edit and the exact final text are verified before playback.");
});

const settingsInputs = [
  elements.duration,
  elements.wpm,
  elements.countdown,
  elements.typos,
  elements.planning,
  elements.drafting,
  elements.polishing,
  elements.rhythmProfile,
  elements.variation,
  elements.hesitation,
  elements.typoFrequency,
  elements.correctionDelay,
  elements.editPause,
  elements.revisionDensity,
];
for (const input of settingsInputs) {
  input.addEventListener("input", () => {
    updateReadouts();
    persistForm();
  });
}

elements.closePanel.addEventListener("click", async () => {
  try {
    await getCurrentWindow().hide();
  } catch {
    document.body.classList.toggle("preview-closed");
  }
});

elements.copyPrompt.addEventListener("click", async () => {
  const request = elements.assignment.value.trim();
  const complete = `${PERFORMANCE_PROMPT}\n\nREVISION DENSITY:\n${revisionInstruction(elements.revisionDensity.value)}\n\nUSER WRITING REQUEST:\n${request || "[Paste your writing request here before sending.]"}`;
  await navigator.clipboard.writeText(complete);
  elements.copyPrompt.textContent = "copied";
  gsap.fromTo(elements.copyPrompt, { scale: 0.94 }, { scale: 1, duration: 0.32, ease: "back.out(2)" });
  window.setTimeout(() => { elements.copyPrompt.textContent = "copy prompt"; }, 1600);
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
    setValidation("error", "attention", errorMessage(error));
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
      if (event.state === "Pressed") await togglePause();
    });
  } catch {
    elements.stateMessage.textContent = "Browser preview. Desktop controls activate in the installed build.";
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

function setupTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[data-panel]"));
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.view;
      tabs.forEach((item) => item.classList.toggle("active", item === tab));
      panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === target));
      const active = panels.find((panel) => panel.dataset.panel === target);
      if (active && !prefersReducedMotion()) {
        gsap.fromTo(active.children, { y: 12, opacity: 0 }, {
          y: 0,
          opacity: 1,
          duration: 0.46,
          stagger: 0.055,
          ease: "power3.out",
          clearProps: "transform,opacity",
        });
      }
    });
  }
}

function animateEntrance(): void {
  if (prefersReducedMotion()) return;
  gsap.from(".utility-header > *", { y: -8, opacity: 0, duration: 0.5, stagger: 0.08, ease: "power3.out" });
  gsap.from(".live-strip, .mode-switch, .view.active > *", {
    y: 14,
    opacity: 0,
    duration: 0.58,
    stagger: 0.07,
    ease: "power3.out",
  });
  gsap.to(".brand-signal i", {
    scaleY: (index) => 0.55 + index * 0.2,
    duration: 0.85,
    repeat: -1,
    yoyo: true,
    stagger: 0.12,
    ease: "sine.inOut",
  });
}

function showValidation(result: ValidationResult): void {
  if (result.valid) {
    const warning = result.warnings[0] ? ` ${result.warnings[0]}` : "";
    setValidation("valid", "verified", `${result.stats.actions} edits, ${result.stats.typedCharacters.toLocaleString()} typed characters, exact final text confirmed.${warning}`);
    elements.performanceSummary.textContent = `${result.stats.actions} edits across ${result.stats.finalCharacters.toLocaleString()} final characters`;
    return;
  }
  setValidation("error", "attention", result.errors.slice(0, 3).join(" "));
}

function setValidation(kind: "neutral" | "valid" | "error", label: string, detail: string): void {
  elements.validationPill.className = `validation-state ${kind}`;
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
    rhythmProfile: elements.rhythmProfile.value as SessionSettings["rhythmProfile"],
    variationPercent: clamp(Number(elements.variation.value), 0, 100),
    hesitationPercent: clamp(Number(elements.hesitation.value), 0, 100),
    typosPerThousand: clamp(Number(elements.typoFrequency.value), 0, 50),
    correctionDelayMs: clamp(Number(elements.correctionDelay.value), 40, 1200),
    editPauseMs: clamp(Number(elements.editPause.value), 0, 3000),
  };
}

function updateReadouts(): void {
  get<HTMLOutputElement>("variation-output").textContent = `${elements.variation.value}%`;
  get<HTMLOutputElement>("hesitation-output").textContent = `${elements.hesitation.value}%`;
  get<HTMLOutputElement>("typo-frequency-output").textContent = `${elements.typoFrequency.value} / 1k`;
  get<HTMLOutputElement>("correction-delay-output").textContent = `${elements.correctionDelay.value} ms`;
  get<HTMLOutputElement>("edit-pause-output").textContent = `${elements.editPause.value} ms`;

  const total = Number(elements.planning.value) + Number(elements.drafting.value) + Number(elements.polishing.value);
  elements.phaseTotal.textContent = `${total}%`;
  elements.phaseTotal.classList.toggle("invalid", total !== 100);
  elements.planningBar.style.width = `${Number(elements.planning.value) / Math.max(total, 1) * 100}%`;
  elements.draftingBar.style.width = `${Number(elements.drafting.value) / Math.max(total, 1) * 100}%`;
  elements.polishingBar.style.width = `${Number(elements.polishing.value) / Math.max(total, 1) * 100}%`;

  const minutes = clamp(Number(elements.duration.value), 1, 480);
  elements.finishTime.textContent = minutes >= 60
    ? `in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
    : `in ${minutes}m`;
}

function renderStatus(): void {
  setControls(status.state);
  const active = ["countdown", "running", "paused"].includes(status.state);
  elements.headerState.textContent = status.state === "running" ? `${progressPercent()}%` : status.state;
  elements.statusDot.className = `status-dot ${status.state}`;
  elements.stateTitle.textContent = status.phase ? `${capitalize(status.phase)} in progress` : stateLabel(status.state);
  elements.stateMessage.textContent = status.targetApplication ? `${status.message} · ${status.targetApplication}` : status.message;
  elements.liveTime.textContent = formatDuration(status.elapsedMs);
  const progress = progressPercent();
  if (prefersReducedMotion()) elements.progress.style.width = `${progress}%`;
  else gsap.to(elements.progress, { width: `${progress}%`, duration: 0.4, ease: "power2.out" });
  if (status.state === "completed") elements.progress.style.width = "100%";
  elements.pause.textContent = status.state === "paused" ? "resume" : "pause";
  elements.pause.disabled = !active;
  elements.stop.disabled = !active;
}

function progressPercent(): number {
  return status.targetDurationMs > 0 ? Math.min(100, Math.round(status.elapsedMs / status.targetDurationMs * 100)) : 0;
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
    promptPreferences: { revisionDensity: elements.revisionDensity.value },
  }));
}

function restoreForm(): void {
  try {
    const stored = JSON.parse(localStorage.getItem("typingbot.form") ?? "null") as {
      assignment?: string;
      performance?: string;
      settings?: Partial<SessionSettings>;
      promptPreferences?: Partial<PromptPreferences>;
    } | null;
    if (!stored) return;
    elements.assignment.value = stored.assignment ?? "";
    elements.performance.value = stored.performance ?? "";
    const settings = { ...defaultSettings, ...stored.settings };
    const preferences = { ...defaultPromptPreferences, ...stored.promptPreferences };
    elements.duration.value = String(settings.durationMinutes);
    elements.wpm.value = String(settings.wpm);
    elements.countdown.value = String(settings.countdownSeconds);
    elements.planning.value = String(settings.planningPercent);
    elements.drafting.value = String(settings.draftingPercent);
    elements.polishing.value = String(settings.polishingPercent);
    elements.typos.checked = settings.correctedTypos;
    elements.rhythmProfile.value = settings.rhythmProfile;
    elements.variation.value = String(settings.variationPercent);
    elements.hesitation.value = String(settings.hesitationPercent);
    elements.typoFrequency.value = String(settings.typosPerThousand);
    elements.correctionDelay.value = String(settings.correctionDelayMs);
    elements.editPause.value = String(settings.editPauseMs);
    elements.revisionDensity.value = preferences.revisionDensity;
    elements.play.disabled = !elements.performance.value.trim();
    elements.performanceSummary.textContent = elements.performance.value.trim()
      ? `${elements.performance.value.length.toLocaleString()} characters loaded`
      : "waiting for model output";
  } catch {
    localStorage.removeItem("typingbot.form");
  }
}

function revisionInstruction(value: string): string {
  if (value === "light") return "Use 10-20 meaningful actions per 500 final words. Include at least one deletion and two replacements.";
  if (value === "balanced") return "Use 20-38 meaningful actions per 500 final words. Include sentence rewrites, one abandoned paragraph, and at least one move.";
  return "Use 35-60 meaningful actions per 500 final words, within the 250-action limit. Build paragraphs in pieces, abandon multiple candidate lines, rewrite several sentences, delete at least one whole paragraph, and move or combine material at least twice. Every change must advance the visible draft rather than repeat cosmetic edits.";
}

function stateLabel(state: SessionStatus["state"]): string {
  const labels: Record<SessionStatus["state"], string> = {
    idle: "Ready for a performance",
    countdown: "Locking onto a destination",
    running: "Playback in progress",
    paused: "Playback paused",
    completed: "Final text verified",
    stopped: "Playback stopped",
    error: "Playback needs attention",
  };
  return labels[state];
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
