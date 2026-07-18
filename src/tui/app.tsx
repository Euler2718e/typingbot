import type { InputRenderable, ScrollBoxRenderable, SelectOption, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPerformancePrompt } from "../core/prompt";
import type {
  PerformanceScript,
  RevisionDensity,
  RhythmProfile,
  SessionSettings,
  SessionStatus,
  ValidationResult,
} from "../core/types";
import { parsePerformanceScript, validatePerformanceScript } from "../core/validate";
import { copyToClipboard } from "./clipboard";
import { EngineClient, type EngineCallbacks } from "./engine";
import { saveFormState, type TuiFormState } from "./state";

const color = {
  bg: "#111311",
  panel: "#191c19",
  panelAlt: "#20241f",
  border: "#3b4139",
  muted: "#838b7f",
  text: "#e7ebe2",
  accent: "#b8d891",
  amber: "#d8bd7f",
  error: "#d7877f",
  planning: "#9dbb88",
  drafting: "#d1b47b",
  polishing: "#91adb8",
} as const;

const idleStatus: SessionStatus = {
  state: "idle",
  phase: null,
  actionIndex: 0,
  actionCount: 0,
  elapsedMs: 0,
  targetDurationMs: 0,
  message: "Paste a performance to begin",
  targetApplication: null,
};

const revisionOptions: SelectOption[] = [
  { name: "light", description: "essential revisions", value: "light" },
  { name: "balanced", description: "visible redrafting", value: "balanced" },
  { name: "deep", description: "dense reconstruction", value: "deep" },
];

const rhythmOptions: SelectOption[] = [
  { name: "steady", description: "controlled pace", value: "steady" },
  { name: "natural", description: "bursts and pauses", value: "natural" },
  { name: "reflective", description: "longer hesitation", value: "reflective" },
];

const booleanOptions: SelectOption[] = [
  { name: "on", description: "type and repair mistakes", value: true },
  { name: "off", description: "no transient mistakes", value: false },
];

const absorbOptions: SelectOption[] = [
  { name: "absorb", description: "swallow your keystrokes while typing", value: true },
  { name: "off", description: "leave your keyboard live", value: false },
];

export interface PlaybackEngine {
  start(): Promise<void>;
  validate(script: PerformanceScript): Promise<void>;
  startSession(script: PerformanceScript, settings: SessionSettings): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

export interface TypingBotAppProps {
  initialState: TuiFormState;
  connectEngine?: boolean;
  persistState?: boolean;
  engineFactory?: (callbacks: EngineCallbacks) => PlaybackEngine;
}

const defaultEngineFactory = (callbacks: EngineCallbacks): PlaybackEngine => new EngineClient(callbacks);

export function TypingBotApp({
  initialState,
  connectEngine = true,
  persistState = true,
  engineFactory = defaultEngineFactory,
}: TypingBotAppProps) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const wide = width >= 104;
  const compact = height < 32;
  const [form, setForm] = useState(initialState);
  const [status, setStatus] = useState(idleStatus);
  const [focusIndex, setFocusIndex] = useState(0);
  const [engineReady, setEngineReady] = useState(!connectEngine);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [notice, setNotice] = useState("offline · nothing leaves this computer");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const assignmentRef = useRef<TextareaRenderable>(null);
  const performanceRef = useRef<TextareaRenderable>(null);
  const workspaceRef = useRef<ScrollBoxRenderable>(null);
  const timingRef = useRef<ScrollBoxRenderable>(null);

  const engine = useMemo(() => engineFactory({
    onReady: (event) => {
      setEngineReady(true);
      setShortcutReady(event.globalShortcut);
      setNotice(event.warning || "native playback engine ready");
    },
    onStatus: setStatus,
    onControl: (state) => setStatus((current) => ({
      ...current,
      state,
      message: controlMessage(state),
    })),
    onError: setNotice,
    onExit: () => {
      setEngineReady(false);
      setNotice("playback engine stopped");
    },
  }), [engineFactory]);

  useEffect(() => {
    if (!connectEngine) return;
    void engine.start().catch((error) => setNotice(errorMessage(error)));
    return () => { void engine.close(); };
  }, [connectEngine, engine]);

  useEffect(() => {
    if (!persistState) return;
    const timeout = setTimeout(() => {
      void saveFormState(form).catch((error) => setNotice(`Could not save settings: ${errorMessage(error)}`));
    }, 350);
    return () => clearTimeout(timeout);
  }, [form, persistState]);

  const setSettings = useCallback((patch: Partial<SessionSettings>) => {
    setForm((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    setValidation(null);
  }, []);

  const copyPrompt = useCallback(async () => {
    const request = form.assignment.trim() || "[Paste your writing request here before sending.]";
    try {
      const prompt = buildPerformancePrompt(request, form.promptPreferences, form.settings);
      await copyToClipboard(prompt);
      setNotice("complete model prompt copied to the system clipboard");
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [form.assignment, form.promptPreferences, form.settings]);

  const validate = useCallback(async (play: boolean) => {
    setBusy(true);
    try {
      const script = parsePerformanceScript(form.performance);
      const result = validatePerformanceScript(script, form.settings);
      setValidation(result);
      if (!result.valid) {
        setNotice(result.errors.slice(0, 2).join(" · "));
        return;
      }
      await engine.validate(script);
      setNotice(`${result.stats.actions} edits verified · exact final text confirmed`);
      if (play) {
        await engine.startSession(script, form.settings);
        setStatus({
          ...idleStatus,
          state: "countdown",
          actionCount: result.stats.actions,
          targetDurationMs: form.settings.durationMinutes * 60_000,
          message: `Switch to the destination textbox within ${form.settings.countdownSeconds} seconds`,
        });
      }
    } catch (error) {
      setValidation(null);
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [engine, form.performance, form.settings]);

  const togglePause = useCallback(async () => {
    try {
      if (status.state === "paused") {
        await engine.resume();
        setStatus((current) => ({ ...current, state: "running", message: "Playback resumed" }));
      } else if (status.state === "running" || status.state === "countdown") {
        await engine.pause();
        setStatus((current) => ({ ...current, state: "paused", message: "Playback paused" }));
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [engine, status.state]);

  const stop = useCallback(async () => {
    try {
      await engine.stop();
      setStatus((current) => ({ ...current, state: "stopped", message: "Session stopped by user" }));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [engine]);

  const quit = useCallback(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      renderer.destroy();
      process.exit(0);
    };
    const timeout = setTimeout(finish, 600);
    void engine.close().finally(() => {
      clearTimeout(timeout);
      finish();
    });
  }, [engine, renderer]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      quit();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setFocusIndex((current) => (current + (key.shift ? -1 : 1) + 20) % 20);
      return;
    }
    if (key.ctrl && key.name === "g") {
      key.preventDefault();
      void copyPrompt();
    }
    if (key.ctrl && key.name === "return") {
      key.preventDefault();
      void validate(true);
    }
    if (key.ctrl && key.name === "v") {
      key.preventDefault();
      void validate(false);
    }
    if (key.ctrl && key.name === "space") {
      key.preventDefault();
      void togglePause();
    }
    if (key.ctrl && key.name === "x") {
      key.preventDefault();
      void stop();
    }
    if (key.ctrl && (key.name === "down" || key.name === "up")) {
      key.preventDefault();
      const target = wide ? timingRef.current : workspaceRef.current;
      target?.scrollBy(key.name === "down" ? 6 : -6);
    }
  });

  const active = status.state === "running" || status.state === "paused" || status.state === "countdown";
  const progress = status.targetDurationMs > 0
    ? Math.min(100, Math.round(status.elapsedMs / status.targetDurationMs * 100))
    : status.state === "completed" ? 100 : 0;
  const phaseTotal = form.settings.planningPercent + form.settings.draftingPercent + form.settings.polishingPercent;
  const bodyHeight = Math.max(12, height - 9);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={color.bg}>
      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between" alignItems="center" backgroundColor={color.panel}>
        <text fg={color.text}><strong>typingbot</strong><span fg={color.muted}> / terminal writing playback</span></text>
        <text fg={engineReady ? color.accent : color.amber}>{engineReady ? "● engine" : "○ engine"}<span fg={color.muted}>  {shortcutReady ? "global pause armed" : "terminal controls"}</span></text>
      </box>

      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="column" border={["bottom"]} borderColor={color.border}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={statusColor(status.state)}><strong>{statusLabel(status)}</strong><span fg={color.muted}>  {notice}</span></text>
          <text fg={color.text}>{formatDuration(status.elapsedMs)}  <span fg={color.muted}>{progress}%</span></text>
        </box>
        <text fg={status.phase ? phaseColor(status.phase) : color.border}>{progressRail(progress, Math.max(18, width - 4))}</text>
      </box>

      <WorkspaceFrame wide={wide} bodyHeight={bodyHeight} scrollRef={workspaceRef}>
        <box
          width={wide ? "62%" : "100%"}
          height={wide ? "100%" : Math.max(14, bodyHeight * 2)}
          border
          borderColor={color.border}
          title=" compose "
          padding={1}
          flexDirection="column"
        >
          <box height={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>writing request</strong></text>
            <text fg={color.muted}>ctrl+g copy prompt</text>
          </box>
          <textarea
            ref={assignmentRef}
            initialValue={form.assignment}
            focused={focusIndex === 0}
            height={compact ? 3 : 5}
            wrapMode="word"
            placeholder="Paste the assignment, brief, or writing request"
            backgroundColor={color.panelAlt}
            focusedBackgroundColor="#272c25"
            textColor={color.text}
            focusedTextColor={color.text}
            cursorColor={color.accent}
            onContentChange={() => setForm((current) => ({
              ...current,
              assignment: assignmentRef.current?.plainText ?? current.assignment,
            }))}
          />
          <text fg={color.muted}>revision depth</text>
          <select
            focused={focusIndex === 1}
            height={3}
            options={revisionOptions}
            selectedIndex={revisionOptions.findIndex((option) => option.value === form.promptPreferences.revisionDensity)}
            showDescription={false}
            wrapSelection
            backgroundColor={color.panel}
            selectedBackgroundColor={color.panelAlt}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setForm((current) => ({
              ...current,
              promptPreferences: { ...current.promptPreferences, revisionDensity: option.value as RevisionDensity },
            }))}
          />
          <box height={1} marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>performance json</strong></text>
            <text fg={validation?.valid ? color.accent : validation ? color.error : color.muted}>
              {validation?.valid ? "verified" : validation ? "attention" : `${form.performance.length} chars`}
            </text>
          </box>
          <textarea
            ref={performanceRef}
            initialValue={form.performance}
            focused={focusIndex === 2}
            height={compact ? 7 : 11}
            wrapMode="char"
            placeholder={'{ "version": "1.0", "finalText": "..." }'}
            backgroundColor={color.panelAlt}
            focusedBackgroundColor="#272c25"
            textColor="#d9ded4"
            focusedTextColor={color.text}
            cursorColor={color.amber}
            onContentChange={() => {
              setValidation(null);
              setForm((current) => ({
                ...current,
                performance: performanceRef.current?.plainText ?? current.performance,
              }));
            }}
          />
        </box>

        <box
          width={wide ? "38%" : "100%"}
          height={wide ? "100%" : Math.max(30, bodyHeight * 2)}
          border
          borderColor={color.border}
          title=" timing + feel "
          padding={1}
          flexDirection="column"
        >
          <scrollbox ref={timingRef} flexGrow={1} flexDirection="column">
          <text fg={color.text}><strong>session</strong><span fg={color.muted}>  target runtime and base cadence</span></text>
          <NumberField index={3} focusIndex={focusIndex} label="total time" suffix="min" value={form.settings.durationMinutes} onValue={(value) => setSettings({ durationMinutes: clamp(value, 1, 480) })} />
          <NumberField index={4} focusIndex={focusIndex} label="base speed" suffix="wpm" value={form.settings.wpm} onValue={(value) => setSettings({ wpm: clamp(value, 20, 220) })} />
          <NumberField index={5} focusIndex={focusIndex} label="focus window" suffix="sec" value={form.settings.countdownSeconds} onValue={(value) => setSettings({ countdownSeconds: clamp(value, 3, 30) })} />

          <box height={1} marginTop={1} flexDirection="row" justifyContent="space-between">
            <text fg={color.text}><strong>process allocation</strong></text>
            <text fg={phaseTotal === 100 ? color.accent : color.error}>{phaseTotal}%</text>
          </box>
          <NumberField index={6} focusIndex={focusIndex} label="planning" suffix="%" value={form.settings.planningPercent} tint={color.planning} onValue={(value) => setSettings({ planningPercent: clamp(value, 0, 100) })} />
          <NumberField index={7} focusIndex={focusIndex} label="drafting" suffix="%" value={form.settings.draftingPercent} tint={color.drafting} onValue={(value) => setSettings({ draftingPercent: clamp(value, 0, 100) })} />
          <NumberField index={8} focusIndex={focusIndex} label="polishing" suffix="%" value={form.settings.polishingPercent} tint={color.polishing} onValue={(value) => setSettings({ polishingPercent: clamp(value, 0, 100) })} />

          <text fg={color.text} marginTop={1}><strong>rhythm</strong><span fg={color.muted}>  actual keystroke behavior</span></text>
          <select
            focused={focusIndex === 9}
            height={3}
            options={rhythmOptions}
            selectedIndex={rhythmOptions.findIndex((option) => option.value === form.settings.rhythmProfile)}
            showDescription={false}
            wrapSelection
            backgroundColor={color.panel}
            selectedBackgroundColor={color.panelAlt}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setSettings({ rhythmProfile: option.value as RhythmProfile })}
          />
          <select
            focused={focusIndex === 10}
            height={2}
            options={booleanOptions}
            selectedIndex={form.settings.correctedTypos ? 0 : 1}
            showDescription={false}
            wrapSelection
            backgroundColor={color.panel}
            selectedBackgroundColor={color.panelAlt}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setSettings({ correctedTypos: Boolean(option.value) })}
          />
          <NumberField index={11} focusIndex={focusIndex} label="speed variation" suffix="%" value={form.settings.variationPercent} onValue={(value) => setSettings({ variationPercent: clamp(value, 0, 100) })} />
          <NumberField index={12} focusIndex={focusIndex} label="hesitation" suffix="%" value={form.settings.hesitationPercent} onValue={(value) => setSettings({ hesitationPercent: clamp(value, 0, 100) })} />
          <NumberField index={13} focusIndex={focusIndex} label="corrected typos" suffix="/1k" value={form.settings.typosPerThousand} onValue={(value) => setSettings({ typosPerThousand: clamp(value, 0, 50) })} />
          <NumberField index={14} focusIndex={focusIndex} label="correction delay" suffix="ms" value={form.settings.correctionDelayMs} onValue={(value) => setSettings({ correctionDelayMs: clamp(value, 40, 1200) })} />
          <NumberField index={15} focusIndex={focusIndex} label="pause before edits" suffix="ms" value={form.settings.editPauseMs} onValue={(value) => setSettings({ editPauseMs: clamp(value, 0, 3000) })} />
          <NumberField index={16} focusIndex={focusIndex} label="thinking depth" suffix="%" value={form.settings.thinkingIntensity} tint={color.planning} onValue={(value) => setSettings({ thinkingIntensity: clamp(value, 0, 100) })} />
          <NumberField index={17} focusIndex={focusIndex} label="correction travel" suffix="ms" value={form.settings.correctionNavMs} onValue={(value) => setSettings({ correctionNavMs: clamp(value, 4, 200) })} />

          <text fg={color.text} marginTop={1}><strong>keyboard</strong><span fg={color.muted}>  input while playing</span></text>
          <select
            focused={focusIndex === 18}
            height={2}
            options={absorbOptions}
            selectedIndex={form.settings.absorbKeystrokes ? 0 : 1}
            showDescription={false}
            wrapSelection
            backgroundColor={color.panel}
            selectedBackgroundColor={color.panelAlt}
            selectedTextColor={color.accent}
            onChange={(_, option) => option && setSettings({ absorbKeystrokes: Boolean(option.value) })}
          />
          <text fg={color.muted}>esc pauses · ctrl+enter resumes · ctrl+x stops — anywhere</text>
          <input focused={focusIndex === 19} value="" width={1} maxLength={0} textColor={color.panel} cursorColor={color.panel} />
          </scrollbox>
        </box>
      </WorkspaceFrame>

      <box height={2} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between" alignItems="center" backgroundColor={color.panel}>
        <text fg={color.muted}>tab fields  {!wide ? <><span fg={color.text}>ctrl+↑/↓</span> scroll  </> : null}<span fg={color.text}>ctrl+g</span> prompt  <span fg={color.text}>ctrl+v</span> verify  <span fg={color.accent}>ctrl+enter</span> play</text>
        <text fg={active ? color.amber : color.muted}><span fg={color.text}>ctrl+space</span> {status.state === "paused" ? "resume" : "pause"}  <span fg={color.error}>ctrl+x</span> stop  <span fg={color.text}>ctrl+c</span> quit {busy ? " · working" : ""}</text>
      </box>
    </box>
  );
}

function WorkspaceFrame({
  wide,
  bodyHeight,
  scrollRef,
  children,
}: {
  wide: boolean;
  bodyHeight: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  children: React.ReactNode;
}) {
  const layout = {
    height: bodyHeight,
    flexGrow: 1,
    flexDirection: wide ? "row" as const : "column" as const,
    gap: 1,
    padding: 1,
  };
  return wide ? <box {...layout}>{children}</box> : <scrollbox ref={scrollRef} {...layout}>{children}</scrollbox>;
}

function NumberField({
  index,
  focusIndex,
  label,
  suffix,
  value,
  tint = color.muted,
  onValue,
}: {
  index: number;
  focusIndex: number;
  label: string;
  suffix: string;
  value: number;
  tint?: string;
  onValue: (value: number) => void;
}) {
  const ref = useRef<InputRenderable>(null);
  return (
    <box height={1} flexDirection="row" justifyContent="space-between">
      <text fg={tint}>{label}</text>
      <box width={12} flexDirection="row" justifyContent="flex-end">
        <input
          ref={ref}
          width={7}
          value={String(value)}
          focused={focusIndex === index}
          textColor={color.text}
          focusedTextColor={color.text}
          backgroundColor={color.panelAlt}
          focusedBackgroundColor="#30362d"
          cursorColor={color.accent}
          onInput={(raw) => {
            const parsed = Number(raw);
            if (raw.trim() && Number.isFinite(parsed)) onValue(parsed);
          }}
        />
        <text width={5} fg={color.muted}> {suffix}</text>
      </box>
    </box>
  );
}

function statusLabel(status: SessionStatus): string {
  if (status.phase) return `${status.phase} · ${status.actionIndex + 1}/${Math.max(status.actionCount, 1)}`;
  const labels: Record<SessionStatus["state"], string> = {
    idle: "ready",
    countdown: "choose destination",
    running: "playing",
    paused: "paused",
    completed: "complete",
    stopped: "stopped",
    error: "attention",
  };
  return labels[status.state];
}

function controlMessage(state: SessionStatus["state"]): string {
  if (state === "paused") return "Paused · press Ctrl+Enter anywhere to resume";
  if (state === "stopped") return "Stopped with the global Ctrl+X shortcut";
  if (state === "running") return "Resumed from the global shortcut";
  return "Playback control updated";
}

function statusColor(state: SessionStatus["state"]): string {
  if (state === "error" || state === "stopped") return color.error;
  if (state === "paused" || state === "countdown") return color.amber;
  if (state === "running" || state === "completed") return color.accent;
  return color.text;
}

function phaseColor(phase: NonNullable<SessionStatus["phase"]>): string {
  return color[phase];
}

function progressRail(percent: number, width: number): string {
  const size = Math.max(8, width);
  const filled = Math.round(size * Math.min(100, Math.max(0, percent)) / 100);
  return `${"━".repeat(filled)}${"─".repeat(size - filled)}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
